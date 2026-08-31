import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    BookOpen,
    Zap,
    GlobeOff,
    Gauge,
    Shield,
    Radio,
    Search,
    ChevronRight,
    ArrowRight,
    Layers,
    Cpu,
    Workflow,
    AlertCircle,
    CheckCircle2,
    ShieldAlert,
    Server,
    Laptop,
    Smartphone,
    Gamepad2,
    Sliders,
    Eye,
    Database,
    Binary,
    Sparkles
} from 'lucide-react';
import { cn } from '../lib/utils';
import { SPRING_LAYOUT, SPRING_PRESS } from '../lib/ease';

export interface DocumentationViewProps {
    onNavigate?: (nav: string) => void;
    onTriggerScan?: () => void;
}

interface DocSection {
    id: string;
    title: string;
    badge?: string;
    group: string;
    icon: React.ReactNode;
    summary: string;
}

const DOC_SECTIONS: DocSection[] = [
    // 1. Panduan Cepat & Penggunaan
    {
        id: 'quickstart',
        title: 'Langkah Awal & Pemindaian',
        group: 'Panduan Penggunaan',
        icon: <Zap size={16} className="text-amber-400" />,
        summary: 'Cara menghubungkan adapter, memulai scan 1-klik, dan membaca inventaris perangkat.',
    },
    {
        id: 'usage-netcut',
        title: 'Memutus Akses (NetCut / Block)',
        group: 'Panduan Penggunaan',
        icon: <GlobeOff size={16} className="text-rose-400" />,
        summary: 'Cara memutus internet target secara instan, batch block, dan restorasi aman.',
    },
    {
        id: 'usage-throttle',
        title: 'Membatasi Kecepatan (PWM Slider)',
        group: 'Panduan Penggunaan',
        icon: <Gauge size={16} className="text-cyan-400" />,
        summary: 'Mengatur batas kecepatan target dari 0% hingga 100% tanpa membuat target disconnect.',
    },
    {
        id: 'usage-gateway',
        title: 'Smart Gateway & Redirection',
        group: 'Panduan Penggunaan',
        icon: <Layers size={16} className="text-violet-400" />,
        summary: 'Membelokkan akses web target ke Captive Portal atau sinkhole domain tertentu.',
    },
    {
        id: 'usage-gaming',
        title: 'Mode Gaming (Anti-Jitter QoS)',
        group: 'Panduan Penggunaan',
        icon: <Gamepad2 size={16} className="text-emerald-400" />,
        summary: 'Memprioritaskan bandwidth laptop operator untuk ping ultra-rendah dan zero packet loss.',
    },
    {
        id: 'usage-shield',
        title: 'Sentinel Shield (Anti-NetCut)',
        group: 'Panduan Penggunaan',
        icon: <Shield size={16} className="text-sky-400" />,
        summary: 'Melindungi PC operator dari serangan pemotongan akses oleh pihak lain di Wi-Fi.',
    },

    // 2. Cara Kerja Mendalam (Under the Hood)
    {
        id: 'mechanism-arp',
        title: 'Anatomi ARP Spoofing (RFC 826)',
        group: 'Cara Kerja Jaringan',
        icon: <Cpu size={16} className="text-amber-400" />,
        summary: 'Mengapa protokol ARP di jaringan lokal bersifat stateless dan rentan dimanipulasi.',
    },
    {
        id: 'mechanism-pwm',
        title: 'Mekanisme PWM Duty-Cycle Throttling',
        group: 'Cara Kerja Jaringan',
        icon: <Sliders size={16} className="text-cyan-400" />,
        summary: 'Fisika di balik pembatasan kecepatan dengan modulasi pulsa injeksi ARP.',
    },
    {
        id: 'mechanism-fingerprint',
        title: 'Multi-Sensor & DHCP DUID Profiling',
        group: 'Cara Kerja Jaringan',
        icon: <Eye size={16} className="text-purple-400" />,
        summary: 'Cara mengenali perangkat yang mengacak MAC address (Private MAC) secara presisi.',
    },
    {
        id: 'mechanism-autoreblock',
        title: 'Auto-Reblock & Persistence Trap',
        group: 'Cara Kerja Jaringan',
        icon: <Database size={16} className="text-rose-400" />,
        summary: 'Bagaimana SQLite WAL menjerat kembali target yang mencoba reconnect ke Wi-Fi.',
    },
    {
        id: 'mechanism-npcap',
        title: 'Peran Npcap & Kernel Driver NDIS 6',
        group: 'Cara Kerja Jaringan',
        icon: <Binary size={16} className="text-emerald-400" />,
        summary: 'Mengapa Npcap mutlak dibutuhkan Windows untuk merakit frame Layer 2.',
    },

    // 3. Diagram Alir Nyata (Visual Interactive Flows)
    {
        id: 'flow-cut',
        title: 'Diagram Alir: Pemutusan & Restorasi ARP',
        group: 'Diagram Alir Nyata',
        icon: <Workflow size={16} className="text-rose-400" />,
        summary: 'Visualisasi perpindahan paket antara Target, Spoorf, dan Router Gateway.',
    },
    {
        id: 'flow-pwm',
        title: 'Diagram Alir: Gelombang PWM Throttling',
        group: 'Diagram Alir Nyata',
        icon: <Workflow size={16} className="text-cyan-400" />,
        summary: 'Visualisasi gelombang siklus On/Off injeksi racun per sekon.',
    },
    {
        id: 'flow-discovery',
        title: 'Diagram Alir: Multi-Sensor Pipeline',
        group: 'Diagram Alir Nyata',
        icon: <Workflow size={16} className="text-purple-400" />,
        summary: 'Urutan tahapan pemindaian dari ARP broadcast hingga rekonsiliasi DUID.',
    },

    // 4. Aturan Keselamatan & Glosarium
    {
        id: 'safety-invariants',
        title: 'Safety Invariants & Kebal Gateway',
        group: 'Keamanan & Glosarium',
        icon: <ShieldAlert size={16} className="text-amber-400" />,
        summary: '4 aturan mutlak pencegah self-cut dan perlindungan router.',
    },
    {
        id: 'glossary',
        title: 'Kamus Istilah Jaringan (Glossary)',
        group: 'Keamanan & Glosarium',
        icon: <BookOpen size={16} className="text-zinc-400" />,
        summary: 'Pengertian istilah umum: ARP, MAC, OUI, DUID, RTT, BPF, Subnet, dll.',
    }
];

export const DocumentationView: React.FC<DocumentationViewProps> = ({
    onNavigate,
    onTriggerScan
}) => {
    const [selectedDocId, setSelectedDocId] = useState<string>('quickstart');
    const [searchQuery, setSearchQuery] = useState<string>('');

    // Grouping the doc sections
    const filteredDocs = useMemo(() => {
        if (!searchQuery.trim()) return DOC_SECTIONS;
        const q = searchQuery.toLowerCase();
        return DOC_SECTIONS.filter(d =>
            d.title.toLowerCase().includes(q) ||
            d.summary.toLowerCase().includes(q) ||
            d.group.toLowerCase().includes(q) ||
            d.id.toLowerCase().includes(q)
        );
    }, [searchQuery]);

    const groupedDocs = useMemo(() => {
        const groups: { [groupName: string]: DocSection[] } = {};
        for (const doc of filteredDocs) {
            if (!groups[doc.group]) groups[doc.group] = [];
            groups[doc.group].push(doc);
        }
        return groups;
    }, [filteredDocs]);

    const activeDoc = useMemo(() => {
        return DOC_SECTIONS.find(d => d.id === selectedDocId) || DOC_SECTIONS[0];
    }, [selectedDocId]);

    return (
        <div className="w-full max-w-7xl mx-auto font-sans select-none pb-16">
            {/* Header Title Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-6 border-b border-white/[0.08]">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-xl bg-white/[0.06] border border-white/[0.12] flex items-center justify-center text-white shadow-inner">
                            <BookOpen size={16} />
                        </div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">Dokumentasi & Panduan Interaktif</h1>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-white/[0.08] text-zinc-300 border border-white/[0.1]">
                            v2.21.0
                        </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                        Panduan lengkap cara penggunaan fitur, penjelasan cara kerja di bawah kap (*Under-the-Hood*), dan diagram alir nyata protokol jaringan Layer-2/Layer-7.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('netcut')}
                        className="h-9 px-4 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-black/40"
                    >
                        <span>Buka NetCut Table</span>
                        <ArrowRight size={13} />
                    </button>
                </div>
            </div>

            {/* Split Grid: Bouncy Sidebar on Left, Rich Content Viewport on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* ========================================================================= */}
                {/* 1. BEUI BOUNCY SIDEBAR (Doc Navigation)                                  */}
                {/* ========================================================================= */}
                <aside className="lg:col-span-4 xl:col-span-4 w-full bg-[#0e1015] border border-white/[0.08] rounded-2xl p-3 shadow-xl space-y-4 sticky top-6">
                    {/* Inner Search Box */}
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Cari topik atau istilah..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 transition-all font-sans"
                        />
                    </div>

                    {/* Navigation Groups with Bouncy Pill Springs */}
                    <div className="space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                        {Object.entries(groupedDocs).map(([groupName, docs]) => (
                            <div key={groupName} className="space-y-1">
                                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                                    {groupName}
                                </div>
                                <div className="space-y-1">
                                    {docs.map((doc) => {
                                        const isSelected = selectedDocId === doc.id;
                                        return (
                                            <motion.button
                                                key={doc.id}
                                                type="button"
                                                onClick={() => setSelectedDocId(doc.id)}
                                                whileTap={{ scale: 0.96 }}
                                                transition={SPRING_PRESS}
                                                className={cn(
                                                    "group relative flex items-center justify-between w-full px-3 py-2 rounded-xl text-left text-xs transition-all outline-none cursor-pointer",
                                                    isSelected
                                                        ? "text-white font-semibold shadow-sm"
                                                        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                                                )}
                                            >
                                                {/* Bouncy Spring Pill Background for Active Item */}
                                                {isSelected && (
                                                    <motion.div
                                                        layoutId="doc-active-pill"
                                                        transition={SPRING_LAYOUT}
                                                        className="absolute inset-0 rounded-xl bg-white/[0.08] border border-white/[0.14] pointer-events-none shadow-sm"
                                                    />
                                                )}

                                                <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                                                    <span className="shrink-0">{doc.icon}</span>
                                                    <span className="truncate">{doc.title}</span>
                                                </div>

                                                <ChevronRight
                                                    size={13}
                                                    className={cn(
                                                        "relative z-10 transition-transform duration-200 shrink-0",
                                                        isSelected ? "text-white translate-x-0.5" : "text-zinc-600 opacity-0 group-hover:opacity-100"
                                                    )}
                                                />
                                            </motion.button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {filteredDocs.length === 0 && (
                            <div className="py-8 text-center text-xs text-zinc-400">
                                Tidak ada dokumen yang cocok dengan kata kunci.
                            </div>
                        )}
                    </div>
                </aside>

                {/* ========================================================================= */}
                {/* 2. MAIN DOCUMENTATION CONTENT VIEWPORT                                    */}
                {/* ========================================================================= */}
                <main className="lg:col-span-8 xl:col-span-8 w-full min-w-0 space-y-6">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeDoc.id}
                            initial={{ opacity: 0, y: 12, scale: 0.99 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -12, scale: 0.99 }}
                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                            className="bg-[#0e1015] border border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-2xl space-y-8"
                        >
                            {/* Document Header Card */}
                            <div className="space-y-3 pb-6 border-b border-white/[0.08]">
                                <div className="flex items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] text-zinc-300 border border-white/[0.08]">
                                        {activeDoc.group}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 rounded-xl bg-white/[0.06] border border-white/[0.1] shrink-0">
                                        {activeDoc.icon}
                                    </div>
                                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                                        {activeDoc.title}
                                    </h2>
                                </div>
                                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                                    {activeDoc.summary}
                                </p>
                            </div>

                            {/* Render Detailed Chapter based on activeDoc.id */}
                            {activeDoc.id === 'quickstart' && <DocQuickstart onTriggerScan={onTriggerScan} onNavigate={onNavigate} />}
                            {activeDoc.id === 'usage-netcut' && <DocUsageNetcut onNavigate={onNavigate} />}
                            {activeDoc.id === 'usage-throttle' && <DocUsageThrottle onNavigate={onNavigate} />}
                            {activeDoc.id === 'usage-gateway' && <DocUsageGateway onNavigate={onNavigate} />}
                            {activeDoc.id === 'usage-gaming' && <DocUsageGaming onNavigate={onNavigate} />}
                            {activeDoc.id === 'usage-shield' && <DocUsageShield onNavigate={onNavigate} />}

                            {activeDoc.id === 'mechanism-arp' && <DocMechanismArp />}
                            {activeDoc.id === 'mechanism-pwm' && <DocMechanismPwm />}
                            {activeDoc.id === 'mechanism-fingerprint' && <DocMechanismFingerprint />}
                            {activeDoc.id === 'mechanism-autoreblock' && <DocMechanismAutoReblock />}
                            {activeDoc.id === 'mechanism-npcap' && <DocMechanismNpcap />}

                            {activeDoc.id === 'flow-cut' && <DocFlowCut />}
                            {activeDoc.id === 'flow-pwm' && <DocFlowPwm />}
                            {activeDoc.id === 'flow-discovery' && <DocFlowDiscovery />}

                            {activeDoc.id === 'safety-invariants' && <DocSafetyInvariants />}
                            {activeDoc.id === 'glossary' && <DocGlossary />}
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
};

/* ========================================================================= */
/* CHAPTER COMPONENTS (Interactive Content & Visual Diagrams)                 */
/* ========================================================================= */

// 1. QUICKSTART
const DocQuickstart: React.FC<{ onTriggerScan?: () => void; onNavigate?: (nav: string) => void }> = ({ onTriggerScan, onNavigate }) => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🚀 Memulai dalam 3 Langkah Sederhana</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                    <div className="size-6 rounded-lg bg-amber-500/20 text-amber-400 font-mono text-xs font-bold flex items-center justify-center border border-amber-500/30">
                        1
                    </div>
                    <div className="font-semibold text-white text-xs">Pastikan Terhubung Wi-Fi</div>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                        Periksa indikator Wi-Fi di pojok kanan atas. Spoorf otomatis mendeteksi nama SSID dan gateway router Anda.
                    </p>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                    <div className="size-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-mono text-xs font-bold flex items-center justify-center border border-emerald-500/30">
                        2
                    </div>
                    <div className="font-semibold text-white text-xs">Lakukan Pemindaian (Scan)</div>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                        Tekan tombol <b>Scan Jaringan</b>. Sistem akan menyapu subnet secara paralel menggunakan multi-sensor L2/L3.
                    </p>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                    <div className="size-6 rounded-lg bg-cyan-500/20 text-cyan-400 font-mono text-xs font-bold flex items-center justify-center border border-cyan-500/30">
                        3
                    </div>
                    <div className="font-semibold text-white text-xs">Kelola Akses Target</div>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                        Gunakan tombol sakelar Internet untuk <b>Cut</b>, slider untuk <b>Limit</b>, atau klik baris untuk inspeksi port mendalam.
                    </p>
                </div>
            </div>

            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3">
                <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-400" />
                <div>
                    <strong className="text-white font-semibold">Prasyarat Driver Npcap:</strong> Spoorf membutuhkan driver Npcap (mode WinPcap API-compatible) dan hak akses Administrator di Windows untuk menginjeksi frame raw Ethernet.
                </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
                <button
                    type="button"
                    onClick={() => {
                        onTriggerScan?.();
                        onNavigate?.('netcut');
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-500/20"
                >
                    <Sparkles size={14} />
                    <span>Mulai Scan Sekarang</span>
                </button>

                <button
                    type="button"
                    onClick={() => onNavigate?.('netcut')}
                    className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white font-semibold text-xs border border-white/[0.1] transition-all flex items-center gap-2 cursor-pointer"
                >
                    <GlobeOff size={14} />
                    <span>Lihat Tabel Perangkat</span>
                </button>
            </div>
        </div>
    );
};

// 2. USAGE NETCUT
const DocUsageNetcut: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">⚡ Cara Memutus & Memulihkan Akses Jaringan Target</h3>
            <p>
                Fitur <b>NetCut</b> memungkinkan Anda memutus akses internet perangkat tertentu di jaringan lokal secara instan tanpa perlu menyentuh router fisik atau mengetahui password admin router.
            </p>

            <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3">
                    <div className="size-5 rounded-md bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">A</div>
                    <div>
                        <b className="text-white">Memutus Perangkat Tunggal (Single Cut):</b>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Cari baris perangkat di tabel, lalu klik tombol sakelar bulat berwarna hijau pada kolom <b>Internet</b>. Status akan seketika berubah menjadi merah bertuliskan <b>OFFLINE / BLOCKED</b>.
                        </p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3">
                    <div className="size-5 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">B</div>
                    <div>
                        <b className="text-white">Memulihkan Akses (Instant Safe Restore):</b>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Klik kembali tombol sakelar merah. Spoorf akan menyuntikkan 5x paket restorasi ARP resmi dengan MAC asli router untuk membersihkan tabel ARP target seketika tanpa perlu restart perangkat.
                        </p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3">
                    <div className="size-5 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">C</div>
                    <div>
                        <b className="text-white">Aksi Massal (Batch Selection):</b>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Klik tombol <b>Pilih Perangkat</b> di pojok kanan atas tabel. Centang kotak perangkat yang diinginkan, lalu tekan tombol <b>Block (N)</b> atau <b>Restore (N)</b> untuk eksekusi serentak.
                        </p>
                    </div>
                </div>
            </div>

            <div className="pt-2">
                <button
                    type="button"
                    onClick={() => onNavigate?.('netcut')}
                    className="px-4 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-all flex items-center gap-2 cursor-pointer shadow-md"
                >
                    <GlobeOff size={14} />
                    <span>Buka Menu NetCut Target</span>
                </button>
            </div>
        </div>
    );
};

// 3. USAGE THROTTLE
const DocUsageThrottle: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🎛️ Cara Mengatur Batas Kecepatan (PWM Bandwidth Throttling)</h3>
            <p>
                Jika Anda tidak ingin memutus target sepenuhnya (agar pemilik HP tidak curiga), gunakan fitur <b>PWM Throttling</b> untuk memperlambat internet target menjadi 25%, 50%, atau 75%.
            </p>

            <div className="p-4 rounded-xl bg-[#12141a] border border-white/[0.08] space-y-3">
                <div className="text-xs font-semibold text-white flex items-center gap-2">
                    <Sliders size={14} className="text-cyan-400" />
                    Langkah Mengatur Slider Kecepatan:
                </div>
                <ol className="list-decimal list-inside space-y-2 text-xs text-zinc-300">
                    <li>Klik baris target pada tabel untuk membuka panel <b>Security & Telemetry Sidebar</b> di sisi kanan.</li>
                    <li>Geser slider <b>Speed Limit</b> ke persentase yang diinginkan (misal: <b>35%</b>).</li>
                    <li>Sistem seketika beralih ke mode <i>Pulse-Width Modulation</i>: paket racun dikirim secara berdenyut (*duty cycle*) sehingga koneksi target lambat namun tidak memicu icon tanda seru pada HP target.</li>
                    <li>Untuk melepas batasan, geser kembali slider ke <b>100% (Unrestricted)</b>.</li>
                </ol>
            </div>

            <div className="pt-2">
                <button
                    type="button"
                    onClick={() => onNavigate?.('netcut')}
                    className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-cyan-500/20"
                >
                    <Sliders size={14} />
                    <span>Coba Atur Speed Limit Target</span>
                </button>
            </div>
        </div>
    );
};

// 4. USAGE GATEWAY
const DocUsageGateway: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🌐 Smart Gateway, DNS Spoofing & Redirection</h3>
            <p>
                Menu <b>Smart Gateway</b> dan <b>Security Arsenal</b> memungkinkan Anda bertindak sebagai gerbang inspeksi Layer-7 dan membelokkan lalu lintas DNS target.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                    <div className="font-semibold text-white text-xs flex items-center gap-2">
                        <Layers size={14} className="text-purple-400" />
                        Domain Sinkhole & DNS Blocker
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                        Masukkan domain seperti <code className="text-amber-300">tiktok.com</code> atau <code className="text-amber-300">*.ads.com</code>. Semua kueri DNS target untuk domain tersebut akan dijawab dengan IP sinkhole <code className="text-zinc-300">0.0.0.0</code>.
                    </p>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                    <div className="font-semibold text-white text-xs flex items-center gap-2">
                        <Radio size={14} className="text-cyan-400" />
                        Captive Portal Redirection
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-normal">
                        Membelokkan target ke halaman portal autentikasi lokal untuk simulasi pengujian login WiFi atau halaman pengumuman administrator.
                    </p>
                </div>
            </div>

            <div className="pt-2">
                <button
                    type="button"
                    onClick={() => onNavigate?.('gateway')}
                    className="px-4 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 text-white font-semibold text-xs transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-purple-500/20"
                >
                    <Layers size={14} />
                    <span>Buka Smart Gateway</span>
                </button>
            </div>
        </div>
    );
};

// 5. USAGE GAMING
const DocUsageGaming: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🎮 Mode Gaming: Anti-Jitter QoS & Latency Prioritization</h3>
            <p>
                Saat Anda bermain game online (seperti Valorant, Dota 2, Mobile Legends, atau CS2) di jaringan Wi-Fi yang ramai, unduhan dari pengguna lain sering menyebabkan lonjakan *ping spike* (*jitter*).
            </p>

            <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs space-y-2">
                <div className="font-semibold text-white flex items-center gap-2">
                    <Gamepad2 size={15} className="text-cyan-400" />
                    Cara Kerja Mode Gaming:
                </div>
                <p className="text-zinc-300 leading-relaxed">
                    Saat Mode Gaming diaktifkan, Spoorf memantau lonjakan throughput target lain secara real-time. Jika bandwidth gateway mendekati jenuh, Spoorf menerapkan *micro-throttling* adaptif ke target penyedot kuota berat untuk menjaga kestabilan ping laptop operator tetap di bawah <b>20-30 ms</b>.
                </p>
            </div>

            <div className="pt-2">
                <button
                    type="button"
                    onClick={() => onNavigate?.('gaming')}
                    className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-cyan-500/20"
                >
                    <Gamepad2 size={14} />
                    <span>Aktifkan Mode Gaming</span>
                </button>
            </div>
        </div>
    );
};

// 6. USAGE SHIELD
const DocUsageShield: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🛡️ Sentinel Shield: Pertahanan Pasif dari Serangan NetCut</h3>
            <p>
                Apakah orang lain di kos atau kantor Anda juga menggunakan software NetCut untuk memutus laptop Anda? <b>Sentinel Shield</b> adalah modul pertahanan pasif yang melindungi Anda.
            </p>

            <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                        <b className="text-white">Deteksi Injeksi Palsu:</b>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Sentinel Shield mendengarkan frame ARP yang masuk. Jika ada penyerang yang mengaku sebagai Router Gateway, sistem langsung menandai MAC penyerang sebagai *Rogue Attacker*.
                        </p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                        <b className="text-white">Auto-Healing & Static Binding:</b>
                        <p className="text-xs text-zinc-400 mt-0.5">
                            Secara otomatis mengunci entri tabel ARP lokal Anda dan membalas dengan paket verifikasi ke router sehingga koneksi laptop Anda tidak pernah putus.
                        </p>
                    </div>
                </div>
            </div>

            <div className="pt-2">
                <button
                    type="button"
                    onClick={() => onNavigate?.('shield')}
                    className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-sky-500/20"
                >
                    <Shield size={14} />
                    <span>Buka Sentinel Shield</span>
                </button>
            </div>
        </div>
    );
};

// 7. MECHANISM ARP
const DocMechanismArp: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">⚙️ Anatomi Protokol ARP (RFC 826) & Celah Keamanannya</h3>
            
            <p>
                Di jaringan lokal (Layer 2 Ethernet / Wi-Fi), perangkat tidak saling berkomunikasi menggunakan IP address secara langsung, melainkan menggunakan <b>MAC Address</b> (alamat fisik kartu jaringan).
            </p>

            <div className="p-4 rounded-xl bg-[#12141a] border border-white/[0.08] space-y-3 font-mono text-xs">
                <div className="text-zinc-400"># Analogi Sederhana:</div>
                <div className="text-white">
                    IP Address = <span className="text-cyan-400">"Nama Orang"</span> (192.168.1.55)<br />
                    MAC Address = <span className="text-amber-400">"Nomor KTP / Wajah Asli"</span> (a8:3b:76:0c:dc:55)
                </div>
            </div>

            <div className="space-y-3">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">Mengapa ARP Rentan Terhadap Spoofing?</h4>
                <p className="text-xs text-zinc-400">
                    Protokol ARP dibuat pada tahun 1982 (RFC 826) dengan prinsip <i>stateless</i> dan tanpa autentikasi kriptografis. Artinya:
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-xs text-zinc-300 pl-2">
                    <li>Perangkat akan menerima dan memperbarui tabel ARP-nya setiap kali menerima pesan <code className="text-amber-300">ARP Reply ("is-at")</code>, meskipun perangkat tersebut <b>tidak pernah memintanya</b> (*Gratuitous/Unsolicited ARP*).</li>
                    <li>Sistem tidak memverifikasi apakah pengirim paket benar-benar pemilik IP yang sah.</li>
                </ul>
            </div>

            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-200 text-xs">
                <strong className="text-white font-semibold">Taktik Spoorf:</strong> Spoorf mengirimkan paket ARP Reply ke Target mengatakan <i>"Router Gateway berada di MAC saya"</i>, dan mengirimkan paket ke Router mengatakan <i>"Target berada di MAC saya"</i>. Seluruh lalu lintas kini melewati Spoorf.
            </div>
        </div>
    );
};

// 8. MECHANISM PWM
const DocMechanismPwm: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🌊 Fisika PWM Throttling: Modulasi Pulsa Siklus Racun</h3>
            <p>
                Memutus akses sepenuhnya (*Blackhole Cut*) sangat mudah terdeteksi oleh korban karena Windows/Android akan segera menampilkan tanda seru kuning atau peringatan <i>"No Internet Connection"</i>.
            </p>

            <div className="p-4 rounded-xl bg-[#12141a] border border-white/[0.08] space-y-4">
                <div className="text-xs font-semibold text-white">Bagaimana Spoorf Mengatur Kecepatan Tanpa Disconnect?</div>
                <p className="text-xs text-zinc-400">
                    Sistem menggunakan teknik <b>Pulse-Width Modulation (PWM)</b> dengan siklus waktu jendela 1 detik:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                        <b>Duty Cycle ON (Poison Active):</b><br />
                        Selama sekian milidetik, paket racun dikirim sehingga paket data target dijatuhkan.
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                        <b>Duty Cycle OFF (Restoration Pause):</b><br />
                        Sistem membiarkan paket target lolos selama sisa jendela waktu agar TCP handshake / ACK tidak timeout.
                    </div>
                </div>
            </div>
        </div>
    );
};

// 9. MECHANISM FINGERPRINT
const DocMechanismFingerprint: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🔍 Multi-Sensor Ensemble & Mengatasi Randomized MAC (Private MAC)</h3>
            
            <p>
                Sistem operasi modern (iOS 14+, Android 10+, Windows 11) secara default mengacak MAC address mereka (*Private MAC*) setiap kali menyambung ke Wi-Fi. Hal ini membuat pemindaian ARP konvensional gagal melacak perangkat.
            </p>

            <div className="space-y-3">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">Ensemble 5 Lapisan Spoorf:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                        <div className="font-semibold text-white text-xs">1. DHCP Option 61 (DUID)</div>
                        <p className="text-[11px] text-zinc-400 mt-1">Identitas unik perangkat keras yang tetap sama meskipun MAC berubah.</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                        <div className="font-semibold text-white text-xs">2. NetBIOS Node Status (UDP 137)</div>
                        <p className="text-[11px] text-zinc-400 mt-1">Mengambil nama komputer Windows dan workgroup secara aktif.</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                        <div className="font-semibold text-white text-xs">3. mDNS Bonjour (UDP 5353)</div>
                        <p className="text-[11px] text-zinc-400 mt-1">Membaca broadcast nama perangkat Apple (iPhone, iPad, MacBook).</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                        <div className="font-semibold text-white text-xs">4. SSDP UPnP (UDP 1900)</div>
                        <p className="text-[11px] text-zinc-400 mt-1">Mendeteksi Smart TV Samsung/LG, CCTV, dan perangkat IoT.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 10. MECHANISM AUTOREBLOCK
const DocMechanismAutoReblock: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🪤 Auto-Reblock State Machine & SQLite WAL Trap</h3>
            <p>
                Saat perangkat korban dimatikan atau terputus dari Wi-Fi, status blokirnya tidak hilang.
            </p>

            <div className="p-4 rounded-xl bg-[#12141a] border border-white/[0.08] space-y-3">
                <div className="text-xs font-semibold text-white">Siklus Penjeratan Otomatis:</div>
                <div className="space-y-2 text-xs text-zinc-300">
                    <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-rose-400 shrink-0" />
                        <span><b>Langkah 1:</b> Perangkat diblokir -&gt; Status <code>is_blocked = 1</code> tersimpan permanen di database SQLite (WAL mode).</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-amber-400 shrink-0" />
                        <span><b>Langkah 2:</b> Korban mematikan WiFi atau ganti IP -&gt; Status beralih ke <code>Offline (Cached)</code>.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-400 shrink-0" />
                        <span><b>Langkah 3:</b> Korban kembali tersambung -&gt; Sniffer DHCP / ARP mendeteksi kehadiran target -&gt; Spoorf langsung menginjeksi paket blokir seketika (&lt; 0.5 detik).</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 11. MECHANISM NPCAP
const DocMechanismNpcap: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🛡️ Mengapa Npcap Wajib Digunakan di Windows?</h3>
            <p>
                Sistem operasi Windows secara default memblokir aplikasi <i>user-space</i> dari pembuatan frame Ethernet Layer-2. Npcap menyediakan filter driver NDIS 6 berkinerja tinggi di tingkat kernel.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 space-y-1">
                    <b className="text-white">Tanpa Npcap ❌</b>
                    <p className="text-zinc-400 text-[11px]">Windows hanya mengizinkan pengiriman socket TCP/UDP standar. ARP Spoofing, PWM Throttling, dan Sniffer DHCP tidak dapat berjalan.</p>
                </div>
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 space-y-1">
                    <b className="text-white">Dengan Npcap ✅</b>
                    <p className="text-zinc-300 text-[11px]">Scapy dapat merakit raw Ethernet frame, menyuntikkan paket dengan latensi mikro-detik, dan memindai ratusan host secara instan.</p>
                </div>
            </div>
        </div>
    );
};

// 12. FLOW CUT (Interactive Visual Diagram)
const DocFlowCut: React.FC = () => {
    const [step, setStep] = useState<number>(1);

    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">📊 Diagram Interaktif: Alur Pemutusan ARP Cut</h3>
                <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] p-1 rounded-lg">
                    {[1, 2, 3, 4].map(s => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setStep(s)}
                            className={cn(
                                "px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all",
                                step === s ? "bg-rose-500 text-white shadow-sm" : "text-zinc-400 hover:text-white"
                            )}
                        >
                            Fase {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Interactive Visual Canvas */}
            <div className="p-6 rounded-2xl bg-[#090a0c] border border-white/[0.08] relative overflow-hidden">
                <div className="grid grid-cols-3 gap-4 text-center items-center">
                    {/* Node 1: Target Phone */}
                    <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                        <Smartphone size={24} className="text-sky-400" />
                        <div className="font-semibold text-white text-xs">Target Device</div>
                        <span className="font-mono text-[10px] text-zinc-400">192.168.1.55</span>
                    </div>

                    {/* Node 2: Spoorf Operator PC */}
                    <div className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300",
                        step >= 2 ? "bg-rose-500/10 border-rose-500/40 shadow-lg shadow-rose-500/10" : "bg-white/[0.03] border-white/[0.08]"
                    )}>
                        <Laptop size={24} className={step >= 2 ? "text-rose-400" : "text-zinc-400"} />
                        <div className="font-semibold text-white text-xs">Spoorf Sentinel</div>
                        <span className="font-mono text-[10px] text-zinc-400">Operator PC</span>
                    </div>

                    {/* Node 3: Router Gateway */}
                    <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                        <Server size={24} className="text-emerald-400" />
                        <div className="font-semibold text-white text-xs">Default Gateway</div>
                        <span className="font-mono text-[10px] text-emerald-400">192.168.1.1</span>
                    </div>
                </div>

                {/* Step Description Banner */}
                <div className="mt-6 p-4 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs">
                    {step === 1 && (
                        <div>
                            <span className="font-semibold text-emerald-400 font-mono">Fase 1 (Kondisi Normal):</span> Target mengirim paket langsung ke Router Gateway melalui tabel ARP asli.
                        </div>
                    )}
                    {step === 2 && (
                        <div>
                            <span className="font-semibold text-rose-400 font-mono">Fase 2 (Injeksi ARP Poisoning):</span> Spoorf menyuntikkan paket racun dua arah. Target mengira Spoorf adalah Router, Router mengira Spoorf adalah Target.
                        </div>
                    )}
                    {step === 3 && (
                        <div>
                            <span className="font-semibold text-amber-400 font-mono">Fase 3 (Blackhole / Access Cut):</span> Spoorf mematikan fungsi IP Forwarding untuk IP target. Seluruh paket target dibuang (*dropped*), internet target putus.
                        </div>
                    )}
                    {step === 4 && (
                        <div>
                            <span className="font-semibold text-cyan-400 font-mono">Fase 4 (Instant Safe Restore):</span> Saat tombol sakelar dipulihkan, Spoorf mengirim paket ARP murni dengan MAC asli router untuk menetralkan tabel ARP dalam 0.1 detik.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// 13. FLOW PWM
const DocFlowPwm: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">📊 Diagram Alir: Gelombang Siklus PWM Throttling</h3>
            <p>
                Visualisasi perbandingan antara pemutusan total (Blackhole) dengan pembatasan halus (PWM 50%):
            </p>

            <div className="p-4 rounded-xl bg-[#090a0c] border border-white/[0.08] space-y-4 font-mono text-xs">
                <div>
                    <div className="text-rose-400 font-semibold mb-1">1. Mode Cut (Limit = 0%):</div>
                    <div className="p-2.5 rounded bg-rose-950/40 border border-rose-500/20 text-rose-300 text-[11px]">
                        {"[RACUN 100%] -----------------------------------------> (Paket Dijatuhkan Penuh)"}
                    </div>
                </div>

                <div>
                    <div className="text-cyan-400 font-semibold mb-1">2. Mode PWM Throttling (Limit = 50%):</div>
                    <div className="p-2.5 rounded bg-cyan-950/40 border border-cyan-500/20 text-cyan-300 text-[11px] space-y-1">
                        <div>[500ms LOLOS: ACK/TCP OK] ──────┐</div>
                        <div>{"                                └────── [500ms RACUN: DROP] ─── (Kecepatan Turun 50%)"}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 14. FLOW DISCOVERY
const DocFlowDiscovery: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">📊 Diagram Alir: Pipeline Multi-Sensor Discovery</h3>

            <div className="space-y-2 font-mono text-xs">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <span>1. Layer-2 ARP Sweep (Broadcast Who-Has)</span>
                    <span className="text-emerald-400 font-bold">0.8 Detik</span>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <span>2. Layer-3 Multicast Probe (SSDP UPnP & mDNS)</span>
                    <span className="text-purple-400 font-bold">Paralel</span>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <span>3. Layer-4 NetBIOS Node Status (UDP 137)</span>
                    <span className="text-cyan-400 font-bold">Paralel</span>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <span>4. Layer-7 DHCP Option 61 (DUID Matching)</span>
                    <span className="text-amber-400 font-bold">Zero-Collision</span>
                </div>
            </div>
        </div>
    );
};

// 15. SAFETY INVARIANTS
const DocSafetyInvariants: React.FC = () => {
    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">🛡️ 4 Invariant Mutlak Keselamatan Sistem</h3>
            
            <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                    <div className="font-semibold text-emerald-400 text-xs">1. Gateway Immunity (is_gateway: true)</div>
                    <p className="text-xs text-zinc-400">Router default gateway tidak akan pernah bisa ditargetkan atau diputus oleh sistem.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                    <div className="font-semibold text-emerald-400 text-xs">2. Controller Self-Protection (is_self: true)</div>
                    <p className="text-xs text-zinc-400">Laptop operator secara otomatis dikenali dengan badge [This PC] dan kebal dari self-cut.</p>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                    <div className="font-semibold text-cyan-400 text-xs">3. RFC 1918 Private Subnet Strictness</div>
                    <p className="text-xs text-zinc-400">Seluruh operasi paket diisolasi hanya pada alamat subnet lokal privat (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).</p>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                    <div className="font-semibold text-purple-400 text-xs">4. Loopback Control-Plane & IPC Security</div>
                    <p className="text-xs text-zinc-400">API Node & Python hanya membuka port ke 127.0.0.1 dengan exact-match CORS dan bearer token per sesi.</p>
                </div>
            </div>
        </div>
    );
};

// 16. GLOSSARY
const DocGlossary: React.FC = () => {
    const terms = [
        { term: 'ARP', desc: 'Address Resolution Protocol: protokol untuk memetakan IP address ke alamat fisik MAC address.' },
        { term: 'MAC Address', desc: 'Alamat unik 48-bit kartu jaringan fisik perangkat keras (contoh: a8:3b:76:0c:dc:55).' },
        { term: 'Default Gateway', desc: 'Router yang menghubungkan jaringan lokal Anda ke internet publik (biasanya 192.168.1.1).' },
        { term: 'DUID', desc: 'DHCP Unique Identifier: pengenal unik perangkat keras yang dipakai pada DHCP Option 61.' },
        { term: 'RTT (Ping)', desc: 'Round-Trip Time: waktu tempuh paket bolak-balik dari PC ke router dalam satuan milidetik (ms).' },
        { term: 'Jitter', desc: 'Fluktuasi atau variasi ketidakstabilan latensi ping dalam rentang waktu tertentu.' },
        { term: 'Npcap', desc: 'Driver kernel Windows NDIS 6 untuk menangkap dan menginjeksi paket raw Ethernet.' },
        { term: 'Sinkhole', desc: 'Teknik pengalihan kueri DNS domain terlarang ke alamat non-aktif (0.0.0.0).' }
    ];

    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">📖 Kamus Istilah Jaringan (Glossary)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {terms.map(t => (
                    <div key={t.term} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
                        <div className="font-mono font-bold text-white text-xs text-amber-300">{t.term}</div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">{t.desc}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};
