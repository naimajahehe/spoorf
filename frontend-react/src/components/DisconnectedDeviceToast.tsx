import type { FC } from 'react';
import { useEffect } from 'react';
import { WifiOff, X } from 'lucide-react';
import { Device } from '../types';
import { getResolvedDeviceName } from '../lib/deviceSort';

interface Props {
    device: Device;
    onDismiss: (mac: string) => void;
}

export const DisconnectedDeviceToast: FC<Props> = ({ device, onDismiss }) => {
    // Auto dismiss after 4.5 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(device.mac);
        }, 4500);
        return () => clearTimeout(timer);
    }, [device.mac, onDismiss]);

    const deviceName = getResolvedDeviceName(device);

    return (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#14151a] border border-rose-500/20 shadow-[0_8px_20px_rgba(0,0,0,0.7)] backdrop-blur-xl text-xs select-none w-full">
            <div className="flex items-center gap-2.5 min-w-0">
                <WifiOff size={14} className="text-rose-400 shrink-0" />
                <div className="flex flex-col min-w-0">
                    <span className="font-medium text-white truncate text-[11px] leading-tight">
                        {deviceName}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-mono leading-tight">
                        Terputus dari jaringan
                    </span>
                </div>
            </div>
            <button
                type="button"
                onClick={() => onDismiss(device.mac)}
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 ml-1 outline-none cursor-pointer"
                title="Tutup Notifikasi"
                aria-label="Tutup"
            >
                <X size={12} />
            </button>
        </div>
    );
};
