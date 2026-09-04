import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    BookOpen,
    Zap,
    GlobeOff,
    Gauge,
    Shield,
    Search,
    ChevronRight,
    ArrowRight,
    Layers,
    CheckCircle2,
    Server,
    Laptop,
    Smartphone,
    Gamepad2,
    Sliders,
    Database,
    Binary,
    Sparkles,
    X,
    Play,
    Pause,
    RotateCcw,
    Activity,
    Radio
} from 'lucide-react';
import { cn } from '../lib/utils';

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
    {
        id: 'guide-quickstart-discovery',
        title: 'Pemindaian Subnet & Multi-Sensor Pipeline',
        group: 'Panduan & Mekanisme Terpadu',
        icon: <Zap size={14} className="text-zinc-400" />,
        summary: 'Panduan scan 1-klik, multi-sensor L2/L3/L4/L7, bypass MAC acak via DUID, dan peran driver Npcap.',
    },
    {
        id: 'guide-netcut-arp',
        title: 'Pemutusan Akses (NetCut) & Anatomi ARP RFC 826',
        group: 'Panduan & Mekanisme Terpadu',
        icon: <GlobeOff size={14} className="text-zinc-400" />,
        summary: 'Panduan memutus internet instan, batch block, anatomi manipulasi ARP cache, dan auto-reblock SQLite WAL.',
    },
    {
        id: 'guide-throttle-pwm',
        title: 'Pembatasan Bandwidth & Osiloskop PWM',
        group: 'Panduan & Mekanisme Terpadu',
        icon: <Gauge size={14} className="text-zinc-400" />,
        summary: 'Panduan slider kecepatan, sains Pulse-Width Modulation, dan osiloskop gelombang kotak digital interaktif.',
    },
    {
        id: 'guide-gateway',
        title: 'Smart Gateway, DNS Sinkhole & L7 Interception',
        group: 'Panduan & Mekanisme Terpadu',
        icon: <Layers size={14} className="text-zinc-400" />,
        summary: 'Membelokkan DNS target ke IP 0.0.0.0, Captive Portal, dan arsitektur inspeksi TLS/SSL Leaf Certificate.',
    },
    {
        id: 'guide-gaming',
        title: 'Mode Gaming QoS 2.0 (Anti-Jitter Engine)',
        group: 'Panduan & Mekanisme Terpadu',
        icon: <Gamepad2 size={14} className="text-zinc-400" />,
        summary: 'Dual engine Auto Airtime (20%) vs Blackhole Priority (0%), parser ICMP RTT fisik, dan Anti-Self-Cut.',
    },
    {
        id: 'guide-shield-safety',
        title: 'Sentinel Shield & 4 Invarian Keselamatan Mutlak',
        group: 'Panduan & Mekanisme Terpadu',
        icon: <Shield size={14} className="text-zinc-400" />,
        summary: 'Pertahanan anti-spoofing pasif, static ARP binding kernel Windows, deteksi rogue DHCP, dan invarian sistem.',
    },
    {
        id: 'guide-glossary',
        title: 'Kamus Istilah Jaringan (Exhaustive Glossary)',
        group: 'Referensi Teknis',
        icon: <BookOpen size={14} className="text-zinc-400" />,
        summary: 'Pengertian mendalam: ARP, MAC, OUI, DUID, RFC 826, RTT, Jitter, Npcap NDIS 6, BPF, WeakHost, WAL, dll.',
    }
];

export const DocumentationView: React.FC<DocumentationViewProps> = ({
    onNavigate,
    onTriggerScan
}) => {
    const [selectedDocId, setSelectedDocId] = useState<string>('guide-quickstart-discovery');
    const [searchQuery, setSearchQuery] = useState<string>('');

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
        <div className="w-full max-w-6xl mx-auto font-sans select-none pb-20 px-2 sm:px-4">
            {/* Header Title Section - Clean Monochromatic */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-8 border-b border-white/[0.07]">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-white tracking-tight">Dokumentasi & Panduan</h1>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.05] text-zinc-400 border border-white/[0.08]">
                            v2.33.0 &bull; Unified
                        </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5 max-w-2xl leading-relaxed">
                        Panduan operasional lengkap yang memadukan instruksi visual, anatomi teknis protokol, serta diagram alur interaktif.
                    </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('netcut')}
                        className="h-8 px-3.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                        <span>Tabel Perangkat</span>
                        <ArrowRight size={13} className="text-zinc-400" />
                    </button>
                </div>
            </div>

            {/* Split Layout: Minimalist Editorial Sidebar on Left, Fluid Reading Content on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* 1. EDITORIAL SIDEBAR NAVIGATION */}
                <aside className="lg:col-span-4 xl:col-span-4 w-full pr-0 lg:pr-4 lg:border-r lg:border-white/[0.06] space-y-6 lg:sticky lg:top-6 self-start">
                    {/* Minimalist Search Input */}
                    <div className="relative">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Cari dokumentasi..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-transparent border-b border-white/[0.1] pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/40 transition-colors"
                        />
                    </div>

                    {/* Navigation Groups - Clean Calm List without Colors */}
                    <nav className="space-y-6 max-h-[calc(100vh-220px)] overflow-y-auto pr-2 scrollbar-thin">
                        {Object.entries(groupedDocs).map(([groupName, docs]) => (
                            <div key={groupName} className="space-y-1">
                                <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-semibold">
                                    {groupName}
                                </div>
                                <div className="space-y-0.5">
                                    {docs.map((doc) => {
                                        const isSelected = selectedDocId === doc.id;
                                        return (
                                            <button
                                                key={doc.id}
                                                type="button"
                                                onClick={() => setSelectedDocId(doc.id)}
                                                className={cn(
                                                    "group flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer",
                                                    isSelected
                                                        ? "text-white font-medium bg-white/[0.06] border-l-2 border-white pl-2"
                                                        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]"
                                                )}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <span className="shrink-0 text-zinc-400 group-hover:text-zinc-300">{doc.icon}</span>
                                                    <span className="truncate">{doc.title}</span>
                                                </div>
                                                <ChevronRight
                                                    size={12}
                                                    className={cn(
                                                        "transition-transform shrink-0",
                                                        isSelected ? "text-white opacity-100 translate-x-0.5" : "text-zinc-600 opacity-0 group-hover:opacity-100"
                                                    )}
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {filteredDocs.length === 0 && (
                            <div className="py-6 text-center text-xs text-zinc-500">
                                Tidak ada dokumen yang cocok.
                            </div>
                        )}
                    </nav>
                </aside>

                {/* 2. MAIN READING VIEWPORT */}
                <main className="lg:col-span-8 xl:col-span-8 w-full min-w-0 pl-0 lg:pl-2">
                    <AnimatePresence mode="wait">
                        <motion.article
                            key={activeDoc.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.18 }}
                            className="space-y-8"
                        >
                            {/* Document Article Header */}
                            <div className="space-y-2 pb-6 border-b border-white/[0.06]">
                                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                                    {activeDoc.group}
                                </div>
                                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                                    {activeDoc.title}
                                </h2>
                                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed pt-1">
                                    {activeDoc.summary}
                                </p>
                            </div>

                            {/* Render Comprehensive Unified Chapters */}
                            <div className="prose-clean">
                                {activeDoc.id === 'guide-quickstart-discovery' && (
                                    <DocGuideQuickstartDiscovery onTriggerScan={onTriggerScan} onNavigate={onNavigate} />
                                )}
                                {activeDoc.id === 'guide-netcut-arp' && (
                                    <DocGuideNetcutArp onNavigate={onNavigate} />
                                )}
                                {activeDoc.id === 'guide-throttle-pwm' && (
                                    <DocGuideThrottlePwm onNavigate={onNavigate} />
                                )}
                                {activeDoc.id === 'guide-gateway' && (
                                    <DocGuideGateway onNavigate={onNavigate} />
                                )}
                                {activeDoc.id === 'guide-gaming' && (
                                    <DocGuideGaming onNavigate={onNavigate} />
                                )}
                                {activeDoc.id === 'guide-shield-safety' && (
                                    <DocGuideShieldSafety onNavigate={onNavigate} />
                                )}
                                {activeDoc.id === 'guide-glossary' && (
                                    <DocGuideGlossary />
                                )}
                            </div>
                        </motion.article>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
};

/* ========================================================================= */
/* UNIFIED & DETAILED CHAPTER IMPLEMENTATIONS (Calm & Monochromatic)         */
/* ========================================================================= */

// 1. PEMINDAIAN SUBNET & MULTI-SENSOR PIPELINE (Terpadu)
const DocGuideQuickstartDiscovery: React.FC<{ onTriggerScan?: () => void; onNavigate?: (nav: string) => void }> = ({
    onTriggerScan,
    onNavigate
}) => {
    const [isSimulating, setIsSimulating] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(100);
    const [activeLayer, setActiveLayer] = useState<number>(4);

    const startSimulation = () => {
        setIsSimulating(true);
        setProgress(0);
        setActiveLayer(1);

        setTimeout(() => { setActiveLayer(2); setProgress(35); }, 500);
        setTimeout(() => { setActiveLayer(3); setProgress(65); }, 1000);
        setTimeout(() => { setActiveLayer(4); setProgress(100); setIsSimulating(false); }, 1600);
    };

    return (
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {/* Bagian A: Panduan Operasional */}
            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    A. Panduan Praktis Pemindaian Jaringan (Quickstart)
                </h3>
                <p>
                    Sistem pemindaian Spoorf Sentinel dirancang untuk menemukan seluruh perangkat aktif di subnet lokal secara instan tanpa membutuhkan kredensial router fisik.
                </p>

                <div className="relative pl-6 space-y-6 border-l border-white/[0.08] ml-2 my-4">
                    <div className="relative">
                        <span className="absolute -left-[31px] top-0.5 size-5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/[0.12] text-[10px] font-mono font-bold flex items-center justify-center">
                            1
                        </span>
                        <h4 className="text-xs font-semibold text-white">Verifikasi Koneksi Adapter & Gateway</h4>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                            Periksa indikator status di pojok kanan atas. Mesin Python mendeteksi adapter Wi-Fi/Ethernet aktif, IP lokal Anda, serta alamat IP default router (misalnya <code className="text-zinc-200 font-mono">192.168.1.1</code>).
                        </p>
                    </div>

                    <div className="relative">
                        <span className="absolute -left-[31px] top-0.5 size-5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/[0.12] text-[10px] font-mono font-bold flex items-center justify-center">
                            2
                        </span>
                        <h4 className="text-xs font-semibold text-white">Eksekusi Scan Jaringan 1-Klik</h4>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                            Tekan tombol <b>Scan Jaringan</b>. Sistem akan menyapu seluruh 254 alamat IP subnet lokal secara paralel dalam waktu sub-detik (&lt; 0.8 detik).
                        </p>
                    </div>

                    <div className="relative">
                        <span className="absolute -left-[31px] top-0.5 size-5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/[0.12] text-[10px] font-mono font-bold flex items-center justify-center">
                            3
                        </span>
                        <h4 className="text-xs font-semibold text-white">Membaca Inventaris & Profil Perangkat</h4>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                            Setiap perangkat yang terdeteksi akan diperkaya (*enriched*) dengan nama hostname, vendor kartu jaringan (OUI), estimasi sistem operasi, dan status perlindungan *This PC* / *Router Gateway*.
                        </p>
                    </div>
                </div>

                <div className="pt-2 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => {
                            onTriggerScan?.();
                            onNavigate?.('netcut');
                        }}
                        className="h-8 px-4 rounded-lg bg-white text-black hover:bg-zinc-200 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                        <Sparkles size={13} />
                        <span>Mulai Scan Sekarang</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => onNavigate?.('netcut')}
                        className="h-8 px-4 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                        <GlobeOff size={13} />
                        <span>Buka Tabel Perangkat</span>
                    </button>
                </div>
            </div>

            {/* Bagian B: Cara Kerja Jaringan di Bawah Kap */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    B. Cara Kerja Multi-Sensor Pipeline di Bawah Kap (Under the Hood)
                </h3>
                <p>
                    Pemindaian IP tradisional menggunakan perintah ping (ICMP Echo Request) sangat lambat dan sering gagal karena firewall modern Windows, iOS, dan Android secara default menolak paket ICMP. Spoorf mengombinasikan 4 sensor Layer 2 hingga Layer 7:
                </p>

                <div className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-4 text-xs font-mono">
                    <div className="py-3">
                        <div className="text-zinc-200 font-bold flex items-center justify-between">
                            <span>Layer 2: ARP Broadcast Sweep (RFC 826)</span>
                            <span className="text-zinc-400 text-[11px] font-normal">0.8 Detik (Subnet Sweep)</span>
                        </div>
                        <p className="text-zinc-400 font-sans mt-1 text-xs leading-relaxed">
                            Mengirimkan frame raw Ethernet <i>"Who-Has IP X? Tell IP Y"</i> secara serentak ke alamat broadcast <code className="text-zinc-300 font-mono">ff:ff:ff:ff:ff:ff</code>. Setiap perangkat jaringan <b>wajib membalas di tingkat kartu jaringan fisik</b> tanpa terpengaruh oleh firewall OS.
                        </p>
                    </div>

                    <div className="py-3">
                        <div className="text-zinc-200 font-bold flex items-center justify-between">
                            <span>Layer 3: Multicast Probing (SSDP UDP 1900 & mDNS UDP 5353)</span>
                            <span className="text-zinc-400 text-[11px] font-normal">Paralel Non-Blocking</span>
                        </div>
                        <p className="text-zinc-400 font-sans mt-1 text-xs leading-relaxed">
                            Mendengarkan siaran multicast untuk mengungkap Smart TV (Samsung/LG), CCTV IP, konsol game PlayStation/Xbox, dan nama ramah perangkat Apple (iPhone, iPad, MacBook).
                        </p>
                    </div>

                    <div className="py-3">
                        <div className="text-zinc-200 font-bold flex items-center justify-between">
                            <span>Layer 4: NetBIOS Node Status Interrogation (UDP 137)</span>
                            <span className="text-zinc-400 text-[11px] font-normal">Interogasi Aktif</span>
                        </div>
                        <p className="text-zinc-400 font-sans mt-1 text-xs leading-relaxed">
                            Mengirim probe node status aktif ke mesin Windows untuk mengekstrak nama workstation asli, workgroup, dan nama pengguna yang sedang login.
                        </p>
                    </div>

                    <div className="py-3">
                        <div className="text-zinc-200 font-bold flex items-center justify-between">
                            <span>Layer 7: DHCP Option 61 Profiling (Hardware DUID Re-Identification)</span>
                            <span className="text-zinc-400 text-[11px] font-normal">Zero-Duplicate MAC Trap</span>
                        </div>
                        <p className="text-zinc-400 font-sans mt-1 text-xs leading-relaxed">
                            Solusi mutlak terhadap fitur <i>Private / Randomized MAC</i> pada iOS 14+ dan Android 10+. Spoorf membaca tanda tangan DUID (DHCP Unique Identifier) dari paket DHCP ACK untuk menyatukan perangkat yang merotasi MAC ke satu profil inventaris persisten.
                        </p>
                    </div>
                </div>

                {/* Peran Npcap Driver */}
                <div className="border-l-2 border-zinc-500 bg-white/[0.02] pl-4 py-3 my-4 space-y-1 text-xs text-zinc-300">
                    <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
                        <Binary size={13} /> Peran Mutlak Driver Kernel Npcap (NDIS 6 Filter):
                    </span>
                    <p className="text-zinc-400 leading-relaxed font-sans">
                        Windows standar melalui Winsock API memblokir aplikasi user-space dari pembuatan frame raw Ethernet. Npcap menyediakan filter driver kernel berkecepatan tinggi yang memungkinkan Scapy menyuntikkan paket Layer 2 dengan latensi mikro-detik.
                    </p>
                </div>
            </div>

            {/* Bagian C: Diagram Alur Nyata Interaktif */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
                    <div>
                        <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                            C. Diagram Alur Nyata: Pipeline Multi-Sensor Simulator
                        </h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                            Tekan tombol simulasi untuk melihat kronologi penemuan bertahap dari Layer 2 hingga Layer 7.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={startSimulation}
                        disabled={isSimulating}
                        className="h-8 px-3.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-50 text-white font-medium text-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                        <RotateCcw size={12} className={isSimulating ? "animate-spin" : ""} />
                        <span>{isSimulating ? "Memindai..." : "Jalankan Simulasi Scan"}</span>
                    </button>
                </div>

                {/* Interactive Simulation Output */}
                <div className="p-4 bg-black/40 rounded-xl border border-white/[0.06] font-mono text-xs space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 pb-2 border-b border-white/[0.06]">
                        <span className="text-white font-bold flex items-center gap-2">
                            <Radio size={13} className="text-zinc-400" />
                            Live Discovery Stream ({progress}% Selesai)
                        </span>
                        <span className="text-zinc-500 text-[10px]">Durasi: 1.2s Total</span>
                    </div>

                    <div className="space-y-2 text-[11px]">
                        <div className="flex items-center justify-between py-1 border-b border-white/[0.03]">
                            <span className="text-white">192.168.1.1 &bull; Default Gateway Router</span>
                            <span className="text-zinc-400 text-[10px]">Layer 2 ARP Match</span>
                        </div>
                        {activeLayer >= 2 && (
                            <div className="flex items-center justify-between py-1 border-b border-white/[0.03]">
                                <span className="text-white">192.168.1.42 &bull; MacBook-Pro-Naim</span>
                                <span className="text-zinc-400 text-[10px]">Layer 3 mDNS Bonjour</span>
                            </div>
                        )}
                        {activeLayer >= 3 && (
                            <div className="flex items-center justify-between py-1 border-b border-white/[0.03]">
                                <span className="text-white">192.168.1.88 &bull; Samsung-QLED-TV-LivingRoom</span>
                                <span className="text-zinc-400 text-[10px]">Layer 4 SSDP UPnP</span>
                            </div>
                        )}
                        {activeLayer >= 4 && (
                            <div className="flex items-center justify-between py-1">
                                <span className="text-white">192.168.1.62 &bull; iPhone 15 Pro (Private MAC Teracak)</span>
                                <span className="text-zinc-400 text-[10px]">DUID Option 61 (100% Match)</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// 2. PEMUTUSAN AKSES (NETCUT) & ANATOMI ARP RFC 826 (Terpadu)
const DocGuideNetcutArp: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    const [phase, setPhase] = useState<number>(1);
    const [selectedNode, setSelectedNode] = useState<'target' | 'spoorf' | 'gateway' | null>('target');
    const [isPlaying, setIsPlaying] = useState<boolean>(false);

    React.useEffect(() => {
        if (!isPlaying) return;
        const timer = setInterval(() => {
            setPhase(p => (p % 4) + 1);
        }, 3200);
        return () => clearInterval(timer);
    }, [isPlaying]);

    return (
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {/* Bagian A: Panduan Praktis */}
            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    A. Panduan Praktis Pemutusan Akses (NetCut)
                </h3>
                <p>
                    Fitur NetCut memungkinkan Anda memutuskan akses internet perangkat tertentu di jaringan lokal secara instan tanpa perlu menyentuh router fisik atau mengetahui password administrator router.
                </p>

                <div className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-4">
                    <div className="py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            <h4 className="font-semibold text-white text-xs">Memutus Perangkat Tunggal (Single Cut)</h4>
                        </div>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Cari baris target di tabel perangkat, lalu klik tombol sakelar bulat pada kolom <b>Internet</b>. Status seketika berubah menjadi merah bertuliskan <b>OFFLINE / BLOCKED</b>.
                        </p>
                    </div>

                    <div className="py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            <h4 className="font-semibold text-white text-xs">Memulihkan Akses Seketika (Instant Safe Restore)</h4>
                        </div>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Klik kembali tombol sakelar merah. Spoorf menyuntikkan 5x paket pemulih ARP resmi dengan MAC asli router untuk membersihkan cache ARP target dalam waktu 0.1 detik.
                        </p>
                    </div>

                    <div className="py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            <h4 className="font-semibold text-white text-xs">Aksi Massal (Batch Selection)</h4>
                        </div>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Klik tombol <b>Pilih Perangkat</b> di pojok kanan atas tabel. Centang kotak perangkat yang diinginkan, lalu tekan tombol <b>Block (N)</b> atau <b>Restore (N)</b> untuk eksekusi serentak.
                        </p>
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('netcut')}
                        className="h-8 px-4 rounded-lg bg-white text-black hover:bg-zinc-200 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                        <GlobeOff size={13} />
                        <span>Buka Menu NetCut Target</span>
                    </button>
                </div>
            </div>

            {/* Bagian B: Anatomi Jaringan di Bawah Kap */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    B. Anatomi ARP Spoofing (RFC 826) & Auto-Reblock di Bawah Kap
                </h3>
                <p>
                    Di jaringan lokal (Layer 2 Ethernet / Wi-Fi), perangkat tidak saling berkomunikasi menggunakan alamat IP secara langsung, melainkan menggunakan alamat fisik <b>MAC Address</b> (contoh: <code className="text-zinc-200 font-mono">a8:3b:76:0c:dc:55</code>).
                </p>

                <div className="border-l-2 border-zinc-600 bg-white/[0.02] pl-4 py-2.5 my-3 font-mono text-xs space-y-1">
                    <div className="text-zinc-500 text-[11px]"># Analogi Sederhana:</div>
                    <div className="text-zinc-300">
                        IP Address = <span className="text-white font-semibold">"Nama Orang"</span> (192.168.1.55)<br />
                        MAC Address = <span className="text-white font-semibold">"Nomor KTP / Wajah Fisik"</span> (a8:3b:76:0c:dc:55)
                    </div>
                </div>

                <div className="space-y-2 text-xs text-zinc-300">
                    <h4 className="font-semibold text-white text-xs font-mono uppercase text-zinc-400">
                        Celah Desain Protokol ARP (RFC 826):
                    </h4>
                    <ul className="space-y-1.5 list-disc list-outside ml-4 text-zinc-400 leading-relaxed font-sans">
                        <li>Protokol ARP dirancang pada tahun 1982 tanpa mekanisme kriptografi atau autentikasi pengirim.</li>
                        <li>Sistem operasi menerima pesan <b>ARP Reply ("is-at")</b> yang tidak pernah dimintanya (*Unsolicited / Gratuitous ARP*) dan langsung memperbarui cache memorinya.</li>
                        <li><b>Injeksi Dua Arah (Bidirectional Poisoning):</b> Spoorf memberi tahu target bahwa IP router berada di kartu jaringan Spoorf, dan memberi tahu router bahwa IP target berada di kartu jaringan Spoorf.</li>
                        <li><b>Blackhole Mode:</b> Saat tombol blokir aktif, Spoorf mematikan fungsi IP Forwarding untuk target tersebut sehingga seluruh frame data korban dibuang (*dropped*).</li>
                    </ul>
                </div>

                {/* Auto-Reblock Persisten */}
                <div className="border-l-2 border-zinc-500 bg-white/[0.02] pl-4 py-3 my-4 space-y-1 text-xs text-zinc-300">
                    <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
                        <Database size={13} /> Mekanisme Auto-Reblock SQLite WAL:
                    </span>
                    <p className="text-zinc-400 leading-relaxed font-sans">
                        Jika korban mematikan Wi-Fi, mengganti IP DHCP, atau melakukan reboot, status blokir tetap tersimpan di database SQLite (WAL mode). Sniffer DHCP Spoorf yang mendengarkan port UDP 67/68 langsung menjerat kembali korban dalam waktu &lt; 0.5 detik tanpa perlu scan ulang manual.
                    </p>
                </div>
            </div>

            {/* Bagian C: Diagram Alur Nyata Interaktif */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
                    <div>
                        <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                            C. Diagram Alur Nyata: Topologi & Live ARP Cache Inspector
                        </h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                            Gunakan tombol fase atau klik node perangkat untuk memeriksa tabel ARP fisiknya secara real-time.
                        </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => setIsPlaying(!isPlaying)}
                            className={cn(
                                "h-7 px-2.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer",
                                isPlaying ? "bg-white text-black font-semibold" : "bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300"
                            )}
                        >
                            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                            <span>{isPlaying ? 'Pause' : 'Auto Play'}</span>
                        </button>

                        <div className="h-4 w-px bg-white/[0.1] mx-1" />

                        {[1, 2, 3, 4].map(p => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => { setPhase(p); setIsPlaying(false); }}
                                className={cn(
                                    "h-7 px-2 rounded text-[11px] font-mono transition-all cursor-pointer",
                                    phase === p 
                                        ? "bg-white text-black font-semibold shadow-sm" 
                                        : "text-zinc-400 hover:text-white bg-white/[0.02] hover:bg-white/[0.06]"
                                )}
                            >
                                Fase {p}
                            </button>
                        ))}
                    </div>
                </div>

                {/* SVG Topology & Nodes Canvas */}
                <div className="relative py-4 px-3 select-none overflow-hidden bg-gradient-to-b from-white/[0.02] to-transparent rounded-xl border border-white/[0.04]">
                    <div className="flex items-center justify-between text-[11px] font-mono pb-2 border-b border-white/[0.04] text-zinc-400 mb-4">
                        <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-zinc-400" />
                            <span>STATUS:</span>
                            <span className="font-semibold text-white">
                                {phase === 1 && "ROUTING NORMAL (Direct Gateway Traffic)"}
                                {phase === 2 && "ARP POISONING ACTIVE (MITM Ingestion)"}
                                {phase === 3 && "ACCESS CUT (Blackhole Packet Drop)"}
                                {phase === 4 && "ARP RESTORATION (True MAC Re-Injected)"}
                            </span>
                        </div>
                        <span className="text-zinc-500 text-[10px]">Klik node untuk inspect</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center items-center py-6 relative">
                        {/* Target */}
                        <div 
                            onClick={() => setSelectedNode('target')}
                            className={cn(
                                "flex flex-col items-center gap-2 p-3 rounded-xl transition-all cursor-pointer",
                                selectedNode === 'target' ? "bg-white/[0.08] ring-1 ring-white/20" : "hover:bg-white/[0.04]"
                            )}
                        >
                            <div className="size-12 rounded-2xl bg-white/[0.06] text-zinc-200 border border-white/[0.1] flex items-center justify-center shadow-inner">
                                <Smartphone size={22} />
                            </div>
                            <div>
                                <div className="font-semibold text-white text-xs">Target Device</div>
                                <span className="font-mono text-[10px] text-zinc-500">192.168.1.55</span>
                            </div>
                        </div>

                        {/* Spoorf Sentinel */}
                        <div 
                            onClick={() => setSelectedNode('spoorf')}
                            className={cn(
                                "flex flex-col items-center gap-2 p-3 rounded-xl transition-all cursor-pointer -translate-y-3",
                                selectedNode === 'spoorf' ? "bg-white/[0.08] ring-1 ring-white/20" : "hover:bg-white/[0.04]"
                            )}
                        >
                            <div className="size-12 rounded-2xl bg-white/[0.06] text-zinc-200 border border-white/[0.1] flex items-center justify-center shadow-inner">
                                <Laptop size={22} />
                            </div>
                            <div>
                                <div className="font-semibold text-white text-xs">Spoorf Sentinel</div>
                                <span className="font-mono text-[10px] text-zinc-500">Host (192.168.1.100)</span>
                            </div>
                        </div>

                        {/* Default Gateway */}
                        <div 
                            onClick={() => setSelectedNode('gateway')}
                            className={cn(
                                "flex flex-col items-center gap-2 p-3 rounded-xl transition-all cursor-pointer",
                                selectedNode === 'gateway' ? "bg-white/[0.08] ring-1 ring-white/20" : "hover:bg-white/[0.04]"
                            )}
                        >
                            <div className="size-12 rounded-2xl bg-white/[0.06] text-zinc-200 border border-white/[0.1] flex items-center justify-center shadow-inner">
                                <Server size={22} />
                            </div>
                            <div>
                                <div className="font-semibold text-white text-xs">Default Gateway</div>
                                <span className="font-mono text-[10px] text-zinc-400 font-mono">192.168.1.1</span>
                            </div>
                        </div>
                    </div>

                    {/* Live ARP Memory Inspector */}
                    {selectedNode && (
                        <div className="mt-2 p-3 bg-black/40 rounded-lg border border-white/[0.06] font-mono text-xs space-y-2">
                            <div className="flex items-center justify-between text-zinc-400 text-[11px] border-b border-white/[0.06] pb-1.5">
                                <span className="font-bold text-white flex items-center gap-1.5">
                                    <Activity size={12} className="text-zinc-400" />
                                    Live ARP Table Cache &bull; {selectedNode === 'target' ? 'Target (192.168.1.55)' : selectedNode === 'spoorf' ? 'Spoorf PC (192.168.1.100)' : 'Router (192.168.1.1)'}
                                </span>
                                <span className="text-[10px] text-zinc-500 uppercase">Kernel Memory Snapshot</span>
                            </div>

                            {selectedNode === 'target' && (
                                <div className="space-y-1 text-[11px]">
                                    {phase === 1 && (
                                        <div className="text-zinc-200">
                                            192.168.1.1 &rarr; 98:4a:6b:0f:4a:97 [DYNAMIC] &bull; <span className="text-zinc-400">MAC Asli Router (Tabel Sehat)</span>
                                        </div>
                                    )}
                                    {phase === 2 && (
                                        <div className="text-zinc-300">
                                            192.168.1.1 &rarr; a8:3b:76:0c:dc:55 [DYNAMIC] &bull; <span className="text-zinc-400">TERACUNI (Klaim Palsu Spoorf)</span>
                                        </div>
                                    )}
                                    {phase === 3 && (
                                        <div className="text-zinc-300">
                                            192.168.1.1 &rarr; a8:3b:76:0c:dc:55 [DYNAMIC] &bull; <span className="text-zinc-400">TERBLOKIR (Forwarding Mati, Drop 100%)</span>
                                        </div>
                                    )}
                                    {phase === 4 && (
                                        <div className="text-zinc-200">
                                            192.168.1.1 &rarr; 98:4a:6b:0f:4a:97 [RESTORED] &bull; <span className="text-zinc-400">Tabel Dinetralkan oleh True MAC Packet</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {selectedNode === 'spoorf' && (
                                <div className="space-y-1 text-[11px]">
                                    <div className="text-zinc-300">
                                        Physical NIC: Wi-Fi (Npcap NDIS 6) &bull; MAC: a8:3b:76:0c:dc:55
                                    </div>
                                    <div className="text-zinc-400">
                                        Status Forwarding: <span className="text-zinc-200">{phase === 3 ? "DISABLED (Drop Mode)" : "ENABLED / PASS"}</span> &bull; 
                                        Sentinel Shield: <span className="text-zinc-200">LOCKED</span>
                                    </div>
                                </div>
                            )}

                            {selectedNode === 'gateway' && (
                                <div className="space-y-1 text-[11px]">
                                    {phase === 1 && (
                                        <div className="text-zinc-200">
                                            192.168.1.55 &rarr; 82:3a:44:11:22:33 [DYNAMIC] &bull; <span className="text-zinc-400">MAC Asli Target</span>
                                        </div>
                                    )}
                                    {(phase === 2 || phase === 3) && (
                                        <div className="text-zinc-300">
                                            192.168.1.55 &rarr; a8:3b:76:0c:dc:55 [DYNAMIC] &bull; <span className="text-zinc-400">TERACUNI (Gateway Mengirim Paket Target ke Spoorf)</span>
                                        </div>
                                    )}
                                    {phase === 4 && (
                                        <div className="text-zinc-200">
                                            192.168.1.55 &rarr; 82:3a:44:11:22:33 [RESTORED] &bull; <span className="text-zinc-400">Tabel Router Dipulihkan Bersih</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// 3. PEMBATASAN BANDWIDTH & OSILOSKOP PWM (Terpadu)
const DocGuideThrottlePwm: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    const [pwmLimit, setPwmLimit] = useState<number>(50);

    const passMs = Math.round(pwmLimit * 10);
    const dropMs = 1000 - passMs;
    const estSpeed = (50 * (pwmLimit / 100)).toFixed(1);

    return (
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {/* Bagian A: Panduan Praktis */}
            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    A. Panduan Praktis Pengaturan Slider Kecepatan
                </h3>
                <p>
                    Jika Anda tidak ingin memutus target sepenuhnya (agar pemilik perangkat tidak curiga), gunakan slider <b>Speed Limit</b> untuk membatasi kecepatan internet target menjadi 25%, 50%, atau 75%.
                </p>

                <ol className="space-y-2.5 list-decimal list-outside ml-4 text-xs text-zinc-300 leading-relaxed">
                    <li>Klik baris target pada tabel untuk membuka panel <b>Security & Telemetry Sidebar</b> di sisi kanan.</li>
                    <li>Geser slider <b>Speed Limit</b> ke persentase yang diinginkan (misalnya: <b>35%</b>).</li>
                    <li>Sistem seketika beralih ke mode <i>Pulse-Width Modulation</i>: koneksi target melambat secara halus tanpa memunculkan tanda seru kuning atau status *No Internet* pada layar korban.</li>
                    <li>Untuk melepas batasan, geser kembali slider ke <b>100% (Unrestricted)</b>.</li>
                </ol>

                <div className="pt-2">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('netcut')}
                        className="h-8 px-4 rounded-lg bg-white text-black hover:bg-zinc-200 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                        <Sliders size={13} />
                        <span>Atur Speed Limit Target</span>
                    </button>
                </div>
            </div>

            {/* Bagian B: Sains PWM di Bawah Kap */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    B. Fisika & Sains PWM Duty-Cycle di Bawah Kap (Under the Hood)
                </h3>
                <p>
                    Pada sistem operasi Windows, pembatasan bandwidth presisi di Layer 2 biasanya memerlukan traffic shaper kernel khusus. Spoorf memecahkan masalah ini dengan teknik <b>Pulse-Width Modulation (PWM)</b> berfrekuensi 1 Hz (siklus per 1000 milidetik):
                </p>

                <div className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-3 font-mono text-xs">
                    <div className="py-2.5 flex items-start gap-3">
                        <span className="text-zinc-200 font-semibold shrink-0">PASS PHASE (OFF):</span>
                        <span className="text-zinc-400 font-sans">
                            Injeksi racun dijeda selama sekian milidetik. Paket handshake TCP SYN, ACK, dan DNS lolos dengan sempurna sehingga status koneksi sistem operasi korban tetap <b>ESTABLISHED</b>.
                        </span>
                    </div>
                    <div className="py-2.5 flex items-start gap-3">
                        <span className="text-zinc-200 font-semibold shrink-0">DROP PHASE (ON):</span>
                        <span className="text-zinc-400 font-sans">
                            Paket racun disuntikkan secara berdenyut sehingga frame data unduhan target dijatuhkan. Protokol TCP menganggap terjadi kongesti jaringan dan secara otomatis menurunkan *congestion window* (CWND) target.
                        </span>
                    </div>
                </div>

                <div className="border-l-2 border-zinc-500 bg-white/[0.02] pl-4 py-3 my-4 space-y-1 text-xs text-zinc-300">
                    <span className="text-zinc-200 font-semibold">Mengapa Korban Tidak Sadar?</span>
                    <p className="text-zinc-400 leading-relaxed font-sans">
                        Karena paket ACK TCP tetap lolos pada fase pass, socket jaringan tidak pernah mengalami broken pipe. Korban hanya mengira bahwa jaringan Wi-Fi sedang lambat secara alami atau sinyal router sedang lemah.
                    </p>
                </div>
            </div>

            {/* Bagian C: Diagram Alur Nyata Interaktif */}
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
                    <div>
                        <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                            C. Diagram Alur Nyata: Osiloskop Gelombang Kotak PWM Interaktif
                        </h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                            Uji perubahan bentuk gelombang, waktu duty cycle, dan kesehatan socket TCP dengan menggeser slider di bawah.
                        </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        {[0, 25, 50, 75, 100].map(val => (
                            <button
                                key={val}
                                type="button"
                                onClick={() => setPwmLimit(val)}
                                className={cn(
                                    "h-6 px-2 rounded text-[10px] font-mono transition-colors cursor-pointer",
                                    pwmLimit === val ? "bg-white text-black font-bold" : "text-zinc-400 hover:text-white bg-white/[0.03]"
                                )}
                            >
                                {val}%
                            </button>
                        ))}
                    </div>
                </div>

                {/* Slider Input */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-zinc-400 flex items-center gap-1.5">
                            <Sliders size={13} className="text-zinc-400" />
                            Target Bandwidth Limit: <b className="text-white text-sm">{pwmLimit}%</b>
                        </span>
                        <span className="text-zinc-400">
                            Siklus 1000ms: <span className="text-zinc-200">{passMs}ms Pass</span> / <span className="text-zinc-400">{dropMs}ms Drop</span>
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={pwmLimit}
                        onChange={(e) => setPwmLimit(Number(e.target.value))}
                        className="w-full h-1.5 bg-white/[0.1] rounded-lg appearance-none cursor-pointer accent-zinc-200"
                    />
                </div>

                {/* Scope Canvas */}
                <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] font-mono text-xs space-y-4">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-white/[0.04] pb-1.5">
                        <span>DIGITAL SQUARE WAVE (1000ms SAMPLING WINDOW)</span>
                        <span>DUTY CYCLE: {pwmLimit}%</span>
                    </div>

                    <div className="h-28 w-full relative flex items-center">
                        <svg className="w-full h-full" viewBox="0 0 500 100" preserveAspectRatio="none">
                            <line x1="0" y1="20" x2="500" y2="20" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                            <line x1="0" y1="80" x2="500" y2="80" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                            <line x1="250" y1="0" x2="250" y2="100" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />

                            {pwmLimit === 0 ? (
                                <line x1="0" y1="80" x2="500" y2="80" stroke="#71717a" strokeWidth="2.5" />
                            ) : pwmLimit === 100 ? (
                                <line x1="0" y1="20" x2="500" y2="20" stroke="#ffffff" strokeWidth="2.5" />
                            ) : (
                                <path
                                    d={`M 0 20 L ${(pwmLimit / 100) * 500} 20 L ${(pwmLimit / 100) * 500} 80 L 500 80`}
                                    fill="none"
                                    stroke="#e4e4e7"
                                    strokeWidth="2.5"
                                    strokeLinejoin="round"
                                />
                            )}

                            <motion.line
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="100"
                                stroke="rgba(255, 255, 255, 0.4)"
                                strokeWidth="1.5"
                                animate={{ x1: [0, 500], x2: [0, 500] }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            />
                        </svg>

                        <div className="absolute top-1 left-2 text-[10px] text-zinc-300 font-semibold">
                            HIGH (PASS: Frame Lolos & ACK Diterima)
                        </div>
                        <div className="absolute bottom-1 right-2 text-[10px] text-zinc-400 font-semibold">
                            LOW (DROP: Frame Dijatuhkan oleh Racun)
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs border-t border-white/[0.04]">
                        <div>
                            <span className="text-[10px] text-zinc-500 uppercase">Perkiraan Throughput Target</span>
                            <div className="text-white font-bold text-sm mt-0.5">{estSpeed} Mbps <span className="text-xs font-normal text-zinc-400">(asumsi 50 Mbps)</span></div>
                        </div>
                        <div>
                            <span className="text-[10px] text-zinc-500 uppercase">Status Socket TCP Korban</span>
                            <div className="text-white font-semibold text-xs mt-0.5">
                                {pwmLimit > 0 ? (
                                    <span className="text-zinc-200 flex items-center gap-1">
                                        <CheckCircle2 size={12} /> ESTABLISHED (No Disconnect)
                                    </span>
                                ) : (
                                    <span className="text-zinc-400 flex items-center gap-1">
                                        <X size={12} /> DROPPED (Connection Severed)
                                    </span>
                                )}
                            </div>
                        </div>
                        <div>
                            <span className="text-[10px] text-zinc-500 uppercase">Indikator Layar Target</span>
                            <div className="text-zinc-300 text-xs mt-0.5">
                                {pwmLimit === 0 ? "Tanda Seru (Offline)" : "Koneksi Normal (Hanya Lambat)"}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 4. SMART GATEWAY & REDIRECTION (Terpadu)
const DocGuideGateway: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    A. Panduan Praktis Smart Gateway & DNS Sinkhole
                </h3>
                <p>
                    Menu <b>Smart Gateway</b> dan <b>Security Arsenal</b> memungkinkan Anda bertindak sebagai gerbang inspeksi Layer 7 untuk membelokkan lalu lintas DNS target ke domain sinkhole atau portal autentikasi lokal.
                </p>

                <div className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-4">
                    <div className="py-3.5 space-y-1">
                        <h4 className="font-semibold text-white text-xs flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            Domain Sinkhole & DNS Blocker
                        </h4>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Masukkan domain seperti <code className="text-zinc-200 font-mono bg-white/[0.04] px-1 rounded">tiktok.com</code> atau pola wildcard <code className="text-zinc-200 font-mono bg-white/[0.04] px-1 rounded">*.ads.com</code>. Seluruh kueri DNS target untuk domain tersebut dijawab dengan IP sinkhole <code className="text-zinc-200 font-mono bg-white/[0.04] px-1 rounded">0.0.0.0</code>.
                        </p>
                    </div>

                    <div className="py-3.5 space-y-1">
                        <h4 className="font-semibold text-white text-xs flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            Captive Portal Redirection
                        </h4>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Membelokkan browser korban ke server web lokal untuk simulasi pengujian login Wi-Fi atau halaman pengumuman administratif.
                        </p>
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('gateway')}
                        className="h-8 px-4 rounded-lg bg-white text-black hover:bg-zinc-200 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                        <Layers size={13} />
                        <span>Buka Smart Gateway</span>
                    </button>
                </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    B. Arsitektur Dekripsi TLS & CA di Bawah Kap
                </h3>
                <p>
                    Untuk menginspeksi lalu lintas HTTPS yang terenkripsi, Spoorf mengintegrasikan generator Root CA lokal (<code className="text-zinc-200 font-mono bg-white/[0.04] px-1 rounded">spoorf-ca.pem</code>):
                </p>
                <ul className="space-y-1.5 list-disc list-outside ml-4 text-zinc-400 leading-relaxed font-sans">
                    <li>Saat target melakukan handshake TLS ke domain apa pun, modul interceptor men-generate <i>leaf certificate</i> secara on-the-fly yang ditandatangani oleh Sentinel Root CA.</li>
                    <li>IP Forwarding diaktifkan pada kernel Windows melalui perintah <code className="text-zinc-200 font-mono bg-white/[0.04] px-1 rounded">netsh interface ipv4 set interface "Wi-Fi" forwarding=enabled</code>.</li>
                </ul>
            </div>
        </div>
    );
};

// 5. MODE GAMING QOS 2.0 (Terpadu)
const DocGuideGaming: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    A. Panduan Praktis Mode Gaming (Anti-Jitter QoS)
                </h3>
                <p>
                    Saat bermain game kompetitif (Valorant, CS2, Dota 2, Mobile Legends) di Wi-Fi yang padat, lonjakan unduhan dari pengguna lain sering memicu <i>ping spike</i> (*jitter*). Mode Gaming QoS 2.0 memprioritaskan seluruh bandwidth untuk laptop operator.
                </p>

                <div className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-4">
                    <div className="py-3.5 space-y-1">
                        <div className="font-semibold text-white text-xs flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            1. Profil Auto Airtime (20% Limit)
                        </div>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Membatasi seluruh perangkat lain di jaringan menjadi 20% secara proporsional. Koneksi perangkat lain tetap stabil untuk browsing dan streaming, sementara 80% airtime Wi-Fi didedikasikan untuk game Anda.
                        </p>
                    </div>

                    <div className="py-3.5 space-y-1">
                        <div className="font-semibold text-white text-xs flex items-center gap-2">
                            <span className="size-1.5 rounded-full bg-zinc-500" />
                            2. Profil Blackhole Priority (0% Limit)
                        </div>
                        <p className="text-xs text-zinc-400 pl-3.5 leading-relaxed">
                            Memutus total akses internet seluruh perangkat lain. Menjamin latensi ping absolut terendah tanpa gangguan paket sama sekali di jaringan Wi-Fi.
                        </p>
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('gaming')}
                        className="h-8 px-4 rounded-lg bg-white text-black hover:bg-zinc-200 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                        <Gamepad2 size={13} />
                        <span>Buka Mode Gaming</span>
                    </button>
                </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    B. True ICMP RTT Parser & Late-Joiners di Bawah Kap
                </h3>
                <ul className="space-y-2 list-disc list-outside ml-4 text-zinc-400 leading-relaxed font-sans">
                    <li><b>True ICMP RTT:</b> Spoorf tidak menggunakan wall-clock subprocess yang rentan salah saat beban CPU tinggi, melainkan mem-parse nilai milidetik asli <code className="text-zinc-200 font-mono bg-white/[0.04] px-1 rounded">time=&lt;N&gt;ms</code> dari output ICMP fisik Windows.</li>
                    <li><b>Late-Joiners Auto-Throttle:</b> Jika ada perangkat tamu baru yang tersambung ke Wi-Fi saat Gaming Mode sedang berjalan, modul Sniffer DHCP otomatis langsung menerapkan limit tanpa perlu intervensi operator.</li>
                    <li><b>Anti-Self-Cut Hardening:</b> Laptop operator secara mutlak diproteksi dan dikecualikan dari pemotongan kecepatan.</li>
                </ul>
            </div>
        </div>
    );
};

// 6. SENTINEL SHIELD & 4 INVARIAN KESELAMATAN (Terpadu)
const DocGuideShieldSafety: React.FC<{ onNavigate?: (nav: string) => void }> = ({ onNavigate }) => {
    return (
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <div className="space-y-4">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    A. Panduan Praktis Sentinel Shield (Anti-NetCut)
                </h3>
                <p>
                    Sentinel Shield adalah modul pertahanan pasif yang melindungi PC operator dari serangan pemotongan akses atau ARP spoofing oleh pihak ketiga di jaringan yang sama.
                </p>

                <div className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-4">
                    <div className="py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-zinc-400 shrink-0" />
                            <h4 className="font-semibold text-white text-xs">Deteksi Injeksi ARP Palsu & Rogue DHCP</h4>
                        </div>
                        <p className="text-xs text-zinc-400 pl-5 leading-relaxed">
                            Mendengarkan frame ARP di latar belakang. Jika ada pihak yang mengaku sebagai router gateway atau ada DHCP Offer dari server liar, sistem segera menandai MAC penyerang sebagai *Rogue Attacker*.
                        </p>
                    </div>

                    <div className="py-3.5 space-y-1">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-zinc-400 shrink-0" />
                            <h4 className="font-semibold text-white text-xs">Kernel Static ARP Binding</h4>
                        </div>
                        <p className="text-xs text-zinc-400 pl-5 leading-relaxed">
                            Secara otomatis mengunci entri tabel tetangga router di kernel Windows Anda menjadi tipe <b>Permanent/Static</b> sehingga tabel ARP Anda tidak dapat dimanipulasi oleh siapa pun.
                        </p>
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('shield')}
                        className="h-8 px-4 rounded-lg bg-white text-black hover:bg-zinc-200 font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                        <Shield size={13} />
                        <span>Buka Sentinel Shield</span>
                    </button>
                </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white tracking-wide uppercase font-mono text-zinc-400">
                    B. 4 Invarian Mutlak Keselamatan Sistem (Safety Invariants)
                </h3>
                <p>
                    Seluruh arsitektur kode Spoorf Sentinel dilindungi oleh 4 aturan non-negotiable yang divalidasi oleh ratusan unit test:
                </p>

                <div className="space-y-3 font-mono text-xs">
                    <div className="p-3 bg-white/[0.02] border-l-2 border-zinc-600 rounded-r-lg space-y-1">
                        <div className="font-bold text-white text-xs">1. Gateway Immunity (is_gateway: true)</div>
                        <p className="text-zinc-400 font-sans text-xs">Default router gateway tidak akan pernah bisa ditargetkan atau diputus oleh sistem. Upaya spoofing gateway langsung ditolak dengan <code>SpoofError</code>.</p>
                    </div>

                    <div className="p-3 bg-white/[0.02] border-l-2 border-zinc-600 rounded-r-lg space-y-1">
                        <div className="font-bold text-white text-xs">2. Controller Self-Protection (is_self: true)</div>
                        <p className="text-zinc-400 font-sans text-xs">Laptop operator secara otomatis dikenali dengan badge [This PC] dan kebal dari self-cut.</p>
                    </div>

                    <div className="p-3 bg-white/[0.02] border-l-2 border-zinc-600 rounded-r-lg space-y-1">
                        <div className="font-bold text-white text-xs">3. RFC 1918 Private Subnet Scope</div>
                        <p className="text-zinc-400 font-sans text-xs">Seluruh operasi paket diisolasi hanya pada alamat subnet lokal privat (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Boundary IP seperti 0.0.0.0 atau 255.255.255.255 selalu dievaluasi False.</p>
                    </div>

                    <div className="p-3 bg-white/[0.02] border-l-2 border-zinc-600 rounded-r-lg space-y-1">
                        <div className="font-bold text-white text-xs">4. Loopback Control-Plane & IPC Token</div>
                        <p className="text-zinc-400 font-sans text-xs">API backend Node & Python hanya membuka port ke 127.0.0.1 dengan exact-match CORS dan bearer token per sesi.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 7. KAMUS ISTILAH JARINGAN (Exhaustive Technical Glossary)
const DocGuideGlossary: React.FC = () => {
    const terms = [
        { term: 'ARP (RFC 826)', desc: 'Address Resolution Protocol: protokol pemetaan alamat logika IP ke alamat fisik kartu jaringan MAC address di Layer 2.' },
        { term: 'MAC Address', desc: 'Alamat fisik unik 48-bit kartu jaringan perangkat keras (contoh: a8:3b:76:0c:dc:55) yang terbagi menjadi 24-bit OUI dan 24-bit NIC ID.' },
        { term: 'Default Gateway', desc: 'Router yang menjadi pintu keluar utama lalu lintas jaringan lokal Anda menuju internet publik (biasanya 192.168.1.1).' },
        { term: 'DUID (RFC 4361)', desc: 'DHCP Unique Identifier: tanda tangan perangkat keras unik pada DHCP Option 61 yang tetap konsisten saat MAC diacak.' },
        { term: 'RTT (Round-Trip Time)', desc: 'Waktu tempuh paket bolak-balik dari PC ke host tujuan dalam satuan milidetik (ms).' },
        { term: 'Jitter', desc: 'Variasi atau fluktuasi ketidakstabilan latensi RTT dalam rentang waktu tertentu yang menyebabkan patah-patah pada game online.' },
        { term: 'Npcap Driver', desc: 'Driver kernel Windows NDIS 6 berkinerja tinggi untuk menangkap dan menginjeksi frame raw Ethernet.' },
        { term: 'BPF (Berkeley Filter)', desc: 'Mesin virtual kernel untuk memfilter paket jaringan berkecepatan tinggi sebelum diserahkan ke user-space.' },
        { term: 'WeakHost Model', desc: 'Fitur stack IP Windows yang memungkinkan pengiriman dan penerimaan paket melalui antarmuka jaringan yang berbeda.' },
        { term: 'PWM Duty Cycle', desc: 'Persentase waktu fase ON (drop paket) terhadap fase OFF (lolos paket) dalam siklus modulasi 1 detik.' },
        { term: 'Sinkhole DNS', desc: 'Teknik pengalihan kueri domain terlarang ke alamat non-aktif (0.0.0.0) untuk pemblokiran iklan atau situs berbahaya.' },
        { term: 'SQLite WAL Mode', desc: 'Write-Ahead Logging: mode basis data SQLite berkinerja tinggi yang memungkinkan pembacaan dan penulisan konkuren tanpa lock race.' }
    ];

    return (
        <div className="space-y-6 text-xs sm:text-sm text-zinc-300 leading-relaxed">
            <h3 className="text-base font-semibold text-white">📖 Kamus Istilah Jaringan (Exhaustive Glossary)</h3>
            <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06] my-4">
                {terms.map(t => (
                    <div key={t.term} className="py-3 sm:grid sm:grid-cols-4 sm:gap-4 items-baseline">
                        <dt className="font-mono font-semibold text-xs text-zinc-200">{t.term}</dt>
                        <dd className="sm:col-span-3 text-xs text-zinc-400 mt-0.5 sm:mt-0 leading-relaxed">{t.desc}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
};
