import type { FC } from 'react';
import { ShieldOff, Wifi, AlertTriangle } from 'lucide-react';
import { CutStatus } from '../types';
import { cn } from '../lib/utils';

/**
 * "Kill Switch Dua-Stack" — dua jalur (IPv4 & IPv6) yang menunjukkan apakah pemutusan benar-benar
 * ter-enforce di kedua stack. Jalur IPv6 'leak' / IPv4 'off' → merah berdenyut + peringatan, mengubah
 * blind-spot (device yang masih bisa internet via IPv6) jadi alarm yang mencolok.
 */
const laneTheme: Record<string, { dot: string; text: string; pulse: boolean }> = {
    cut:      { dot: 'bg-emerald-400', text: 'text-emerald-300', pulse: false },
    throttle: { dot: 'bg-amber-400',   text: 'text-amber-300',   pulse: false },
    off:      { dot: 'bg-rose-500',    text: 'text-rose-300',    pulse: true },
    leak:     { dot: 'bg-rose-500',    text: 'text-rose-300',    pulse: true },
    na:       { dot: 'bg-zinc-600',    text: 'text-zinc-500',    pulse: false },
};

const fmtPkt = (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const Lane: FC<{ proto: string; status: string; label: string; packets: number }> = ({ proto, status, label, packets }) => {
    const t = laneTheme[status] ?? laneTheme.na;
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <span className={cn('size-2 rounded-full', t.dot, t.pulse && 'animate-pulse')} />
                <span className="w-9 text-[11px] font-mono font-semibold text-zinc-400">{proto}</span>
                <span className={cn('text-[11px] font-mono font-medium', t.text)}>{label}</span>
            </div>
            {status !== 'na' && (
                <span className="text-[10px] font-mono tabular-nums text-zinc-500">{fmtPkt(packets)} pkt</span>
            )}
        </div>
    );
};

export const DualStackKillStatus: FC<{ cut: CutStatus }> = ({ cut }) => {
    const ipv4Label = cut.ipv4 === 'cut' ? 'TERPUTUS' : cut.ipv4 === 'throttle' ? 'DIBATASI' : 'TAK TER-ENFORCE';
    const ipv6Label =
        cut.ipv6 === 'cut' ? 'TERPUTUS' :
        cut.ipv6 === 'leak' ? 'MASIH TERBUKA' :
        'tidak ada (IPv4-only)';
    const leaking = cut.ipv6 === 'leak' || cut.ipv4 === 'off';

    return (
        <div
            className={cn(
                'rounded-lg border p-2.5 space-y-2 transition-colors',
                leaking ? 'border-rose-500/40 bg-rose-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
            )}
        >
            <div className="flex items-center gap-1.5">
                <ShieldOff size={12} className={leaking ? 'text-rose-400' : 'text-emerald-400'} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-400">
                    Kill Switch Dua-Stack
                </span>
            </div>

            <div className="space-y-1.5">
                <Lane proto="IPv4" status={cut.ipv4} label={ipv4Label} packets={cut.ipv4_packets} />
                <Lane proto="IPv6" status={cut.ipv6} label={ipv6Label} packets={cut.ipv6_packets} />
            </div>

            {leaking && (
                <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2 py-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rose-400" />
                    <span className="text-[10px] leading-snug text-rose-200">
                        {cut.ipv6 === 'leak'
                            ? 'Perangkat masih bisa terhubung internet lewat IPv6 — pemutusan belum lengkap.'
                            : 'Ditandai diblokir tapi tak ada sesi aktif di engine — pemutusan tidak ter-enforce.'}
                    </span>
                </div>
            )}

            {!leaking && cut.ipv6 === 'cut' && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-300/80">
                    <Wifi size={11} className="text-emerald-400" />
                    Kedua stack terputus — tak ada jalur internet tersisa.
                </div>
            )}
        </div>
    );
};
