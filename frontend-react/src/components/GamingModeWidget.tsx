import { useState, useEffect, useRef, type CSSProperties } from 'react';
import type { FC } from 'react';
import { Play, Square, Radio, Flame, Check } from 'lucide-react';
import { Device, GamingStatus, GamingTelemetry } from '../types';
import { cn } from '../lib/utils';
import { LiveLineChart } from '@/components/charts/live-line-chart';
import { LiveLine } from '@/components/charts/live-line';
import { LiveYAxis } from '@/components/charts/live-y-axis';

interface Props {
    status: GamingStatus;
    telemetry: GamingTelemetry;
    devices: Device[];
    onToggle: (enabled: boolean, mode?: string, target_ping_ms?: number) => Promise<void>;
}

// ── Palet sinyal (fungsional: warna = kondisi terukur, bukan hias) ──────────────
const SIGNAL = '#37e0a0';   // sehat: di dalam target
const WATCH = '#f5b544';    // mendekati ambang
const CRITICAL = '#ff5c7a'; // di atas ambang / ada packet loss

const MAX_SAMPLES = 60; // ~60 detik jejak

type Health = 'good' | 'watch' | 'critical';
type Point = { time: number; value: number };

function healthOf(ping: number, target: number, loss: number): Health {
    if (loss > 0 || ping > target * 1.5) return 'critical';
    if (ping > target) return 'watch';
    return 'good';
}

const HEALTH_COLOR: Record<Health, string> = { good: SIGNAL, watch: WATCH, critical: CRITICAL };
const HEALTH_WORD: Record<Health, string> = { good: 'stabil', watch: 'mendekati batas', critical: 'tidak stabil' };

function fmtUptime(sec: number): string {
    if (!sec || sec < 0) return '00:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ── Mode isolasi (backend: auto_airtime = 20%, blackhole_priority = 0%) ──────────
const MODES = [
    {
        id: 'auto_airtime',
        label: 'Smart Airtime Priority',
        badge: '20%',
        Icon: Radio,
        desc: 'Batasi semua perangkat lain ke 20% — chat/WhatsApp ringan tetap jalan, sisa airtime Wi-Fi untuk game-mu.',
    },
    {
        id: 'blackhole_priority',
        label: 'Ultra Blackhole Isolation',
        badge: '0%',
        Icon: Flame,
        desc: 'Putus total (0%) semua perangkat lain & buang download mereka ke Dead MAC di router.',
    },
] as const;

type ModeId = (typeof MODES)[number]['id'];

// Spinner kecil yang mengikuti warna teks (border-current) — dipakai saat loading.
const Spinner: FC<{ className?: string }> = ({ className }) => (
    <span
        className={cn('inline-block rounded-full border-2 border-current border-t-transparent animate-spin', className)}
        aria-hidden="true"
    />
);

export const GamingModeWidget: FC<Props> = ({ status, telemetry, devices, onToggle }) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [targetPing, setTargetPing] = useState<number>(status.target_ping_ms || 25);
    const [selectedMode, setSelectedMode] = useState<ModeId>(
        (status.mode as ModeId) === 'blackhole_priority' ? 'blackhole_priority' : 'auto_airtime'
    );
    const [samples, setSamples] = useState<Point[]>([]);
    const lastTsRef = useRef<number>(0);

    const enabled = status.is_enabled;
    const activeMode: ModeId = enabled
        ? ((status.mode as ModeId) === 'blackhole_priority' ? 'blackhole_priority' : 'auto_airtime')
        : selectedMode;
    const ping = telemetry.ping_ms || status.ping_ms || 0;
    const jitter = telemetry.jitter_ms || status.jitter_ms || 0;
    const loss = telemetry.packet_loss_pct ?? status.packet_loss_pct ?? 0;

    const health = healthOf(ping, targetPing, loss);
    const traceColor = HEALTH_COLOR[health];

    // Jumlah perangkat lain yang akan/ sedang dibatasi selama mode aktif.
    const affected = devices.filter((d) => !d.is_gateway && !d.is_self && d.is_online).length;
    const limitPct = activeMode === 'blackhole_priority' ? 0 : 20;

    // Kumpulkan sampel ping tiap kali telemetri baru tiba (buffer bergulir).
    useEffect(() => {
        if (!enabled) return;
        if (telemetry.timestamp === lastTsRef.current) return;
        lastTsRef.current = telemetry.timestamp;
        const v = telemetry.ping_ms;
        if (typeof v !== 'number' || Number.isNaN(v)) return;
        const t = telemetry.timestamp || Date.now() / 1000;
        setSamples((prev) => [...prev, { time: t, value: v }].slice(-MAX_SAMPLES));
    }, [telemetry.timestamp, telemetry.ping_ms, enabled]);

    // Kosongkan jejak saat monitor dimatikan.
    useEffect(() => {
        if (!enabled) setSamples([]);
    }, [enabled]);

    // Loading jujur: bertahan sampai backend mengonfirmasi selesai. Backend mengirim
    // status baru (timestamp berubah) begitu SELURUH proses sekuensial rampung; kita
    // menahan loading sampai itu tiba, atau sampai pengaman waktu memaksa berhenti.
    const pendingBaselineTsRef = useRef<number | null>(null);
    const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearPending = () => {
        pendingBaselineTsRef.current = null;
        if (safetyTimerRef.current) {
            clearTimeout(safetyTimerRef.current);
            safetyTimerRef.current = null;
        }
        setIsUpdating(false);
    };

    const runAction = async (fn: () => Promise<void>) => {
        // Rekam timestamp status SAAT INI sebagai patokan; selesai = timestamp berganti.
        pendingBaselineTsRef.current = status.timestamp ?? 0;
        setIsUpdating(true);
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = setTimeout(clearPending, 20000); // pengaman 20 dtk
        try {
            await fn();
        } catch {
            clearPending(); // gagal -> hentikan loading segera
        }
    };

    // Status baru dari backend (timestamp berbeda) = proses benar-benar selesai.
    useEffect(() => {
        if (pendingBaselineTsRef.current === null) return;
        if (status.timestamp !== pendingBaselineTsRef.current) clearPending();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.timestamp]);

    // Bersihkan timer pengaman saat komponen dilepas.
    useEffect(() => () => {
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    }, []);

    const handleToggle = () => runAction(() => onToggle(!enabled, selectedMode, targetPing));

    const handleModeChange = (mode: ModeId) => {
        setSelectedMode(mode);
        if (enabled) runAction(() => onToggle(true, mode, targetPing));
    };

    const handleTarget = (val: number) => {
        setTargetPing(val);
        if (enabled) runAction(() => onToggle(true, selectedMode, val));
    };

    // Override variabel tema chart agar cocok dengan HUD gelap (mandiri dari .dark global).
    const chartVars: CSSProperties = {
        ['--chart-background' as string]: 'transparent',
        ['--chart-grid' as string]: 'rgba(120,140,170,0.10)',
        ['--chart-foreground' as string]: 'rgba(160,175,195,0.55)',
        ['--chart-foreground-muted' as string]: 'rgba(160,175,195,0.45)',
        ['--chart-label' as string]: 'rgba(160,175,195,0.45)',
        ['--chart-crosshair' as string]: 'rgba(160,175,195,0.30)',
        ['--chart-line-primary' as string]: traceColor,
    } as CSSProperties;

    return (
        <div className="w-full max-w-4xl mx-auto px-1 py-2 text-zinc-200">
            {/* Judul + status */}
            <div className="flex items-end justify-between gap-4 mb-5">
                <div>
                    <h1 className="text-2xl md:text-[28px] font-bold tracking-tight text-white leading-none">
                        Mode Gaming Sentinel
                    </h1>
                    <p className="text-[13px] text-zinc-400 mt-2 max-w-lg leading-snug">
                        Prioritaskan airtime Wi-Fi untuk game-mu. Saat aktif, perangkat lain di jaringan
                        dibatasi lewat ARP agar antrean router lengang — sambil memantau ping ke internet real-time.
                    </p>
                </div>
                {enabled && (
                    <div className="flex items-center gap-2 shrink-0 text-[12px] font-medium">
                        <span
                            className="w-2 h-2 rounded-full motion-safe:animate-pulse"
                            style={{ background: traceColor, boxShadow: `0 0 8px ${traceColor}` }}
                        />
                        <span className="text-zinc-300">Aktif</span>
                        <span className="font-mono tabular-nums text-zinc-500">{fmtUptime(status.uptime_seconds)}</span>
                    </div>
                )}
            </div>

            {/* Hero: live trace (bklit LiveLineChart) + readout ping mengambang */}
            <div className="relative rounded-xl overflow-hidden" style={{ background: 'linear-gradient(180deg,#0d1016,#0a0c10)' }}>
                <div className="h-[220px] md:h-[248px] w-full" style={chartVars}>
                    {enabled && samples.length > 0 ? (
                        <LiveLineChart data={samples} value={ping} window={30} numXTicks={5}>
                            <LiveYAxis position="left" />
                            <LiveLine
                                dataKey="value"
                                stroke={traceColor}
                                strokeWidth={2}
                                pulse
                                fill
                                formatValue={(v: number) => `${Math.round(v)} ms`}
                            />
                        </LiveLineChart>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
                            <p className="text-[13px] text-zinc-400 max-w-xs">
                                {enabled
                                    ? 'Menunggu sampel ping pertama…'
                                    : 'Aktifkan untuk memprioritaskan airtime & memantau koneksimu langsung.'}
                            </p>
                            {!enabled && (
                                <button
                                    onClick={handleToggle}
                                    disabled={isUpdating}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm text-black disabled:opacity-70 disabled:cursor-wait transition-transform active:scale-95"
                                    style={{ background: SIGNAL }}
                                >
                                    {isUpdating ? (
                                        <>
                                            <Spinner className="w-4 h-4" />
                                            {affected > 0 ? `Menerapkan ke ${affected} perangkat…` : 'Menerapkan…'}
                                        </>
                                    ) : (
                                        <>
                                            <Play className="w-4 h-4 fill-black" />
                                            Aktifkan Mode Gaming
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Readout ping mengambang */}
                {enabled && (
                    <div className="absolute top-3 left-4 pointer-events-none">
                        <div className="flex items-baseline gap-1.5">
                            <span className="font-mono tabular-nums text-4xl md:text-5xl font-bold leading-none" style={{ color: traceColor }}>
                                {ping ? Math.round(ping) : '—'}
                            </span>
                            <span className="text-sm text-zinc-500">ms</span>
                        </div>
                        <div className="text-[11px] font-medium mt-1" style={{ color: traceColor }}>
                            {HEALTH_WORD[health]} · target {targetPing} ms
                        </div>
                    </div>
                )}
            </div>

            {/* Readout pendukung */}
            <div className="mt-5 pt-4 border-t border-white/[0.07] grid grid-cols-3 gap-4">
                {[
                    { label: 'Jitter', sub: 'kestabilan ping', val: enabled ? `±${jitter.toFixed(1)}` : '—', unit: 'ms' },
                    { label: 'Packet loss', sub: 'paket hilang', val: enabled ? loss.toFixed(1) : '—', unit: '%' },
                    { label: 'Durasi', sub: 'sejak aktif', val: enabled ? fmtUptime(status.uptime_seconds) : '—', unit: '' },
                ].map((m) => (
                    <div key={m.label}>
                        <div className="flex items-baseline gap-1">
                            <span className="font-mono tabular-nums text-xl font-semibold text-white">{m.val}</span>
                            {m.unit && <span className="text-xs text-zinc-500">{m.unit}</span>}
                        </div>
                        <div className="text-[12px] text-zinc-300 mt-0.5">{m.label}</div>
                        <div className="text-[11px] text-zinc-500">{m.sub}</div>
                    </div>
                ))}
            </div>

            {/* Pemilih mode isolasi */}
            <div className="mt-5 pt-4 border-t border-white/[0.07]">
                <div className="text-[12px] text-zinc-400 mb-2.5">Mode isolasi</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {MODES.map((m) => {
                        const active = selectedMode === m.id;
                        const live = enabled && activeMode === m.id;
                        return (
                            <button
                                key={m.id}
                                onClick={() => handleModeChange(m.id)}
                                disabled={isUpdating}
                                className={cn(
                                    'group text-left rounded-xl border p-3.5 transition-colors disabled:opacity-60',
                                    active
                                        ? 'border-white/25 bg-white/[0.04]'
                                        : 'border-white/[0.08] bg-transparent hover:border-white/15 hover:bg-white/[0.02]'
                                )}
                                style={active ? { boxShadow: `inset 0 -2px 0 ${traceColor}` } : undefined}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <m.Icon className={cn('w-4 h-4', active ? 'text-white' : 'text-zinc-500')} />
                                        <span className={cn('text-[13px] font-semibold', active ? 'text-white' : 'text-zinc-300')}>
                                            {m.label}
                                        </span>
                                    </div>
                                    <span className="flex items-center gap-1.5">
                                        {live && (
                                            <span className="text-[10px] font-mono text-black px-1.5 py-0.5 rounded" style={{ background: traceColor }}>
                                                LIVE
                                            </span>
                                        )}
                                        <span className="font-mono tabular-nums text-[12px] text-zinc-400">{m.badge}</span>
                                        {active && <Check className="w-3.5 h-3.5" style={{ color: traceColor }} />}
                                    </span>
                                </div>
                                <p className="text-[11px] text-zinc-500 leading-relaxed mt-1.5">{m.desc}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Kontrol: target ping + toggle */}
            <div className="mt-5 pt-4 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="text-[12px] text-zinc-400">Target ping</span>
                    <div className="flex items-center gap-1">
                        {[15, 25, 40, 60].map((val) => (
                            <button
                                key={val}
                                onClick={() => handleTarget(val)}
                                disabled={isUpdating}
                                className={cn(
                                    'px-2.5 py-1 rounded-md text-[12px] font-mono tabular-nums transition-colors disabled:opacity-60',
                                    targetPing === val ? 'text-black font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                                )}
                                style={targetPing === val ? { background: SIGNAL } : undefined}
                            >
                                {val}
                            </button>
                        ))}
                        <span className="text-[12px] text-zinc-500 ml-0.5">ms</span>
                    </div>
                </div>

                {enabled && (
                    <button
                        onClick={handleToggle}
                        disabled={isUpdating}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-zinc-200 border border-white/10 hover:border-white/20 hover:bg-white/[0.03] disabled:opacity-60 disabled:cursor-wait transition-colors active:scale-95"
                    >
                        {isUpdating ? (
                            <>
                                <Spinner className="w-3.5 h-3.5" />
                                Menerapkan…
                            </>
                        ) : (
                            <>
                                <Square className="w-3.5 h-3.5" />
                                Hentikan
                            </>
                        )}
                    </button>
                )}
            </div>

            {/* Konsekuensi — jujur soal dampak ke perangkat lain */}
            <p className="mt-4 text-[11px] text-zinc-500 leading-relaxed">
                {activeMode === 'blackhole_priority'
                    ? <>Saat aktif, <span className="text-zinc-400">{affected} perangkat lain</span> diputus total (0%) dari internet selama mode berjalan, lalu dipulihkan otomatis saat dimatikan.</>
                    : <>Saat aktif, <span className="text-zinc-400">{affected} perangkat lain</span> dibatasi ke {limitPct}% selama mode berjalan, lalu dipulihkan otomatis saat dimatikan.</>}
            </p>
        </div>
    );
};
