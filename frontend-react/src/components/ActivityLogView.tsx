import { useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Radar,
    Wifi,
    ShieldAlert,
    Globe,
    Waypoints,
    ChevronDown,
    Trash2,
    Inbox,
    Terminal,
    LayoutList,
    Copy,
    Check,
    type LucideIcon
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from './motion/tabs';
import { ActivityEvent, ActivityCategory, ActivityStatus } from '../types';
import { cn } from '../lib/utils';

interface ActivityLogViewProps {
    events: ActivityEvent[];
    onClear: () => void;
}

type FilterValue = 'all' | ActivityCategory;
type ViewMode = 'terminal' | 'cards';

const CATEGORY_ICON: Record<ActivityCategory, LucideIcon> = {
    scan: Radar,
    device: Wifi,
    security: ShieldAlert,
    traffic: Globe,
    network: Waypoints
};

const STATUS_STYLE: Record<ActivityStatus, { icon: string; iconBg: string; pill: string; accent: string; label: string; term: string }> = {
    info: { icon: 'text-cyan-400', iconBg: 'bg-cyan-500/10 border-cyan-500/20', pill: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20', accent: 'bg-cyan-400/70', label: 'Info', term: 'text-cyan-400' },
    success: { icon: 'text-emerald-400', iconBg: 'bg-emerald-500/10 border-emerald-500/20', pill: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', accent: 'bg-emerald-400/70', label: 'Berhasil', term: 'text-emerald-400' },
    warning: { icon: 'text-amber-400', iconBg: 'bg-amber-500/10 border-amber-500/20', pill: 'bg-amber-500/10 text-amber-300 border-amber-500/20', accent: 'bg-amber-400/70', label: 'Perhatian', term: 'text-amber-400' },
    danger: { icon: 'text-rose-400', iconBg: 'bg-rose-500/10 border-rose-500/20', pill: 'bg-rose-500/10 text-rose-300 border-rose-500/20', accent: 'bg-rose-400/70', label: 'Kritis', term: 'text-rose-400' }
};

const CATEGORY_LABEL: Record<FilterValue, string> = {
    all: 'Semua', device: 'Perangkat', security: 'Keamanan', traffic: 'Trafik', network: 'Jaringan', scan: 'Pindai'
};

// Tag subsistem ala log backend/python, diturunkan dari `tool` (mis. 'dhcp.sniffer' -> 'dhcp').
const tagOf = (tool: string) => (tool.split('.')[0] || 'sys').slice(0, 9);

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function clockOf(ts: number) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

function detailEntriesOf(e: ActivityEvent): [string, string][] {
    if (!e.detail) return [];
    return Object.entries(e.detail)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]);
}

function formatTimeAgo(ts: number): string {
    const diff = Math.max(0, Date.now() - ts);
    const s = Math.floor(diff / 1000);
    if (s < 5) return 'Baru saja';
    if (s < 60) return `${s} dtk lalu`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} mnt lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    return new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Card view (alternatif) ---------- */
const ActivityCard: FC<{ event: ActivityEvent }> = ({ event }) => {
    const [open, setOpen] = useState(false);
    const Icon = CATEGORY_ICON[event.category] || Radar;
    const style = STATUS_STYLE[event.status];
    const detailEntries = detailEntriesOf(event);

    return (
        <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#090a0c] transition-colors hover:border-white/[0.14]">
            <div className={cn('absolute left-0 top-0 h-full w-[3px]', style.accent)} />
            <button
                type="button"
                onClick={() => detailEntries.length > 0 && setOpen(o => !o)}
                className={cn('flex w-full items-center gap-3 px-4 py-3 text-left outline-none', detailEntries.length > 0 ? 'cursor-pointer' : 'cursor-default')}
            >
                <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border', style.iconBg)}>
                    <Icon size={16} className={style.icon} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">{event.title}</span>
                        <span className="hidden shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">{event.tool}</span>
                    </div>
                    <p className="truncate text-xs leading-relaxed text-zinc-400">{event.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                    <span className={cn('hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline', style.pill)}>{style.label}</span>
                    <span className="font-mono text-[10px] text-zinc-500">{formatTimeAgo(event.timestamp)}</span>
                    {detailEntries.length > 0 && (
                        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-zinc-500"><ChevronDown size={14} /></motion.span>
                    )}
                </div>
            </button>
            <AnimatePresence initial={false}>
                {open && detailEntries.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-white/[0.06] px-4 py-3 pl-16 sm:grid-cols-2">
                            {detailEntries.map(([key, value]) => (
                                <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
                                    <span className="text-zinc-500">{key}</span>
                                    <span className="truncate font-mono text-zinc-300">{value}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

/* ---------- Terminal line ---------- */
const TerminalLine: FC<{ event: ActivityEvent }> = ({ event }) => {
    const style = STATUS_STYLE[event.status];
    const detailEntries = detailEntriesOf(event);
    const detailStr = detailEntries.map(([k, v]) => `${k}: ${v}`).join('  ·  ');
    return (
        <div className="group px-3 py-[3px] leading-relaxed hover:bg-white/[0.025]">
            <div className="flex items-start gap-2.5">
                <span className="shrink-0 tabular-nums text-zinc-600">{clockOf(event.timestamp)}</span>
                <span className={cn('shrink-0 select-none', style.term)} aria-hidden>●</span>
                <span className="w-16 shrink-0 truncate text-zinc-500">{tagOf(event.tool)}</span>
                <span className="min-w-0 flex-1 break-words text-zinc-300">
                    {event.description}
                </span>
            </div>
            {detailStr && (
                <div className="pl-[7.4rem] text-zinc-600">
                    <span className="select-none text-zinc-700">↳ </span>{detailStr}
                </div>
            )}
        </div>
    );
};

export const ActivityLogView: FC<ActivityLogViewProps> = ({ events, onClear }) => {
    const [filter, setFilter] = useState<FilterValue>('all');
    const [view, setView] = useState<ViewMode>('terminal');
    const [copied, setCopied] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const atBottomRef = useRef(true);

    const counts = useMemo(() => {
        const c: Record<string, number> = { all: events.length };
        for (const e of events) c[e.category] = (c[e.category] || 0) + 1;
        return c;
    }, [events]);

    // events datang newest-first; untuk terminal urutkan terlama->terbaru (append di bawah)
    const filtered = useMemo(
        () => (filter === 'all' ? events : events.filter(e => e.category === filter)),
        [events, filter]
    );
    const terminalLines = useMemo(() => [...filtered].reverse(), [filtered]);

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };

    // Auto-scroll ke bawah saat event baru, hanya bila pengguna sedang di dasar.
    useEffect(() => {
        if (view === 'terminal' && atBottomRef.current && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [terminalLines.length, view]);

    const handleCopy = async () => {
        const text = terminalLines
            .map(e => `[${clockOf(e.timestamp)}] ${tagOf(e.tool).padEnd(9)} ${e.description}`)
            .join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard tidak tersedia */ }
    };

    const tabs: FilterValue[] = ['all', 'device', 'security', 'traffic', 'network'];

    return (
        <div className="w-full">
            {/* Header */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-base font-semibold tracking-tight text-white">Aktivitas Langsung</h1>
                        <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">spoorf.activity.stream</span>
                        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            <span className="relative flex size-1.5">
                                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                            </span>
                            Live
                        </span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-400">
                        Aliran peristiwa jaringan real-time — pemindaian, koneksi perangkat, DHCP, blokir, dan lalu lintas.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
                        <button
                            type="button"
                            onClick={() => setView('terminal')}
                            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', view === 'terminal' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-white')}
                        >
                            <Terminal size={13} /><span className="hidden sm:inline">Terminal</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setView('cards')}
                            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', view === 'cards' ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-white')}
                        >
                            <LayoutList size={13} /><span className="hidden sm:inline">Kartu</span>
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={events.length === 0}
                        className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition-all', events.length > 0 ? 'border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white' : 'cursor-not-allowed border-white/[0.05] bg-white/[0.02] text-zinc-600 opacity-40')}
                        title="Salin seluruh log"
                    >
                        {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                        <span className="hidden sm:inline">{copied ? 'Tersalin' : 'Salin'}</span>
                    </button>

                    <button
                        type="button"
                        onClick={onClear}
                        disabled={events.length === 0}
                        className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none transition-all', events.length > 0 ? 'border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white' : 'cursor-not-allowed border-white/[0.05] bg-white/[0.02] text-zinc-600 opacity-40')}
                        title="Bersihkan seluruh aktivitas"
                    >
                        <Trash2 size={13} /><span className="hidden sm:inline">Bersihkan</span>
                    </button>
                </div>
            </div>

            {/* Filter tabs */}
            <div className="mb-4">
                <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterValue)} variant="segment">
                    <TabsList>
                        {tabs.map(t => (
                            <TabsTrigger key={t} value={t}>
                                <span>{CATEGORY_LABEL[t]}</span>
                                {(counts[t] || 0) > 0 && (
                                    <span className="ml-1.5 rounded-full border border-white/[0.08] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{counts[t]}</span>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            {/* Empty state */}
            {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.1] bg-[#090a0c] py-20 text-center">
                    <div className="flex size-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-500"><Inbox size={22} /></div>
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium text-zinc-300">Belum ada aktivitas</p>
                        <p className="text-xs text-zinc-500">Event akan muncul di sini secara langsung saat sistem bekerja.</p>
                    </div>
                </div>
            ) : view === 'terminal' ? (
                /* Terminal view */
                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0b0d] shadow-2xl">
                    {/* Window top bar */}
                    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2">
                        <span className="flex gap-1.5">
                            <span className="size-2.5 rounded-full bg-rose-500/70" />
                            <span className="size-2.5 rounded-full bg-amber-500/70" />
                            <span className="size-2.5 rounded-full bg-emerald-500/70" />
                        </span>
                        <span className="ml-1.5 font-mono text-[11px] text-zinc-500">spoorf@sentinel — activity.stream</span>
                        <span className="ml-auto font-mono text-[11px] text-zinc-600">{filtered.length} baris</span>
                    </div>
                    {/* Log stream */}
                    <div
                        ref={scrollRef}
                        onScroll={onScroll}
                        className="max-h-[68vh] min-h-[240px] overflow-y-auto overscroll-contain py-2 font-mono text-[12px]"
                    >
                        {terminalLines.map(e => <TerminalLine key={e.id} event={e} />)}
                    </div>
                </div>
            ) : (
                /* Card view */
                <div className="flex flex-col gap-2.5">
                    <AnimatePresence initial={false}>
                        {filtered.map(event => (
                            <motion.div key={event.id} layout initial={{ opacity: 0, y: -8, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
                                <ActivityCard event={event} />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
};
