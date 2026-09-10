import React from 'react';
import { Command } from 'lucide-react';
import { cn } from '../lib/utils';
import { ThemeMode } from '../lib/theme';

interface TitleBarProps {
  theme?: ThemeMode;
}

/**
 * TitleBar: Komponen bilah judul desktop yang menggantikan titlebar biru native Windows
 * dengan latar belakang tema gelap aplikasi (#090a0c) dan tipografi terstandar.
 * Terhubung dengan Window Controls Overlay (WCO) pada Electron.
 */
export const TitleBar: React.FC<TitleBarProps> = ({ theme = 'dark' }) => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electronAPI?.isDesktop);

  // Jika aplikasi dibuka di web browser biasa (Vite dev), sembunyikan titlebar desktop
  if (!isDesktop) {
    return null;
  }

  const isLight = theme === 'light';

  return (
    <div
      className={cn(
        "h-8 w-full flex items-center justify-between px-3 select-none shrink-0 border-b z-50 transition-colors",
        isLight
          ? "bg-[#f8fafc] text-zinc-700 border-zinc-200"
          : "bg-[#090a0c] text-zinc-300 border-white/[0.06]"
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Brand Identity & Title Bar Text */}
      <div className="flex items-center gap-2 pointer-events-none">
        <div
          className={cn(
            "size-4 rounded flex items-center justify-center shrink-0",
            isLight
              ? "bg-emerald-500/20 text-emerald-600"
              : "bg-emerald-500/15 text-emerald-400"
          )}
        >
          <Command size={10} className="stroke-[2.5]" />
        </div>
        <span
          className={cn(
            "font-semibold text-[11px] tracking-tight",
            isLight ? "text-zinc-800" : "text-zinc-200"
          )}
        >
          Sentinel Ops
        </span>
        <span className={cn("text-[11px]", isLight ? "text-zinc-400" : "text-zinc-600")}>-</span>
        <span
          className={cn(
            "text-[11px] font-medium tracking-normal",
            isLight ? "text-zinc-500" : "text-zinc-400"
          )}
        >
          Network LAN Shield
        </span>
      </div>

      {/* Drag Region Spacer */}
      <div className="flex-1 h-full" />

      {/* Spacer reserved for native Windows Window Controls Overlay (Minimize, Maximize, Close) */}
      <div className="w-36 shrink-0 pointer-events-none h-full" />
    </div>
  );
};

export default TitleBar;
