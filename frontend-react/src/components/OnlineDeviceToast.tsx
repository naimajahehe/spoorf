import type { FC } from 'react';
import { useEffect } from 'react';
import { Wifi, X } from 'lucide-react';
import { Device } from '../types';
import { getResolvedDeviceName } from '../lib/deviceSort';

interface Props {
    device: Device;
    onInspect: (device: Device) => void;
    onDismiss: (mac: string) => void;
}

export const OnlineDeviceToast: FC<Props> = ({ device, onInspect, onDismiss }) => {
    // Auto dismiss after 5 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(device.mac);
        }, 5000);
        return () => clearTimeout(timer);
    }, [device.mac, onDismiss]);

    const deviceName = getResolvedDeviceName(device);

    return (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#14151a] border border-emerald-500/20 shadow-[0_8px_20px_rgba(0,0,0,0.7)] backdrop-blur-xl text-xs select-none w-full">
            {/* Left: Icon & Device Info */}
            <div className="flex items-center gap-2.5 min-w-0">
                <Wifi size={14} className="text-emerald-400 shrink-0" />
                <div className="flex flex-col min-w-0">
                    <span className="font-medium text-white truncate text-[11px] leading-tight">
                        {deviceName}
                    </span>
                    <span className="text-[10px] text-emerald-400 font-medium leading-tight">
                        Terhubung kembali ke jaringan
                    </span>
                </div>
            </div>

            {/* Right: Detail & Close Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
                <button
                    type="button"
                    onClick={() => {
                        onInspect(device);
                        onDismiss(device.mac);
                    }}
                    className="px-2 py-0.5 rounded text-[10px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/25 transition-colors outline-none cursor-pointer"
                    title="Lihat Detail & Telemetri Perangkat"
                >
                    Detail
                </button>

                <button
                    type="button"
                    onClick={() => onDismiss(device.mac)}
                    className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors outline-none cursor-pointer"
                    title="Tutup Notifikasi"
                    aria-label="Tutup"
                >
                    <X size={12} />
                </button>
            </div>
        </div>
    );
};
