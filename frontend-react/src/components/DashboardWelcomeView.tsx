import type { FC } from 'react';
import {
  GlobeOff,
  ArrowRight
} from 'lucide-react';
import { Device, AuthStatusResponse } from '../types';

interface Props {
  authStatus?: AuthStatusResponse | null;
  gateway: Device | null;
  totalHosts: number;
  blockedHosts: number;
  throttledHosts: number;
  shieldStatus?: { is_enabled: boolean; mode: string };
  shieldThreatsCount: number;
  onOpenNetCut: () => void;
  onOpenGateway: () => void;
  onOpenShield: () => void;
  onOpenArsenal: () => void;
}

export const DashboardWelcomeView: FC<Props> = ({
  authStatus,
  gateway,
  totalHosts,
  blockedHosts,
  throttledHosts,
  shieldStatus,
  shieldThreatsCount,
  onOpenNetCut,
  onOpenGateway,
}) => {
  const userName = authStatus?.user?.name || authStatus?.user?.email?.split('@')[0] || 'Operator';

  return (
    <div className="w-full max-w-4xl mx-auto py-8 sm:py-16 select-none font-sans flex flex-col justify-center">
      {/* Pure Typography Greeting (Zero Boxes) */}
      <div className="space-y-3">
        <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
          Welcome back, {userName}
        </h1>
        <p className="text-sm sm:text-base text-zinc-400 max-w-xl leading-relaxed">
          Pemantauan telemetri Layer-2 & perlindungan gateway aktif secara real-time. Kelola target dan lalu lintas jaringan melalui menu NetCut.
        </p>
      </div>

      {/* Clean Boxless Metrics Row */}
      <div className="mt-10 sm:mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 pt-8 border-t border-white/[0.06]">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Target Jaringan
          </div>
          <div className="mt-1 text-2xl font-bold text-white tracking-tight">
            {totalHosts} <span className="text-xs font-normal text-zinc-500 font-mono">Hosts</span>
          </div>
          <div className="mt-0.5 text-xs text-zinc-400 font-mono">
            {blockedHosts > 0 ? (
              <span className="text-rose-400">{blockedHosts} Terputus</span>
            ) : (
              "0 Terputus"
            )} • {throttledHosts} Limit
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Default Gateway
          </div>
          <div className="mt-1 text-2xl font-bold text-white tracking-tight font-mono">
            {gateway?.ip || "Tidak terdeteksi"}
          </div>
          <div className={`mt-0.5 text-xs font-mono flex items-center gap-1.5 ${gateway ? "text-emerald-400" : "text-zinc-500"}`}>
            <span className={`size-1.5 rounded-full ${gateway ? "bg-emerald-400" : "bg-zinc-600"}`} />
            {gateway ? "Kebal / Protected" : "Belum tersedia"}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Sentinel Shield
          </div>
          <div className="mt-1 text-2xl font-bold text-white tracking-tight">
            {shieldStatus?.is_enabled ? "Aktif" : "Standby"}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400 font-mono">
            {shieldThreatsCount} Ancaman Dicegah
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            L2 / L7 Security
          </div>
          <div className="mt-1 text-2xl font-bold text-white tracking-tight">
            Ready
          </div>
          <div className="mt-0.5 text-xs text-zinc-400 font-mono">
            DNS & Traffic Sinkhole
          </div>
        </div>
      </div>

      {/* Clean Actions */}
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onOpenNetCut}
          className="h-10 px-5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-black/40"
        >
          <GlobeOff size={15} />
          <span>Buka Menu NetCut</span>
          <ArrowRight size={14} className="ml-1" />
        </button>

        <button
          type="button"
          onClick={onOpenGateway}
          className="h-10 px-4 text-zinc-400 hover:text-white font-medium text-xs transition-colors flex items-center gap-1.5 cursor-pointer underline underline-offset-4"
        >
          <span>Smart Gateway</span>
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
};
