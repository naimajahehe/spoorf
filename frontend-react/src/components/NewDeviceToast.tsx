import type { FC } from 'react';
import { motion } from 'framer-motion';
import {
    Smartphone,
    Laptop,
    Radio,
    Cpu,
    X,
    WifiOff,
    Wifi,
    ExternalLink
} from 'lucide-react';
import { Device } from '../types';
import { getResolvedDeviceName } from '../lib/deviceSort';

export interface ToastDeviceItem {
    device: Device;
    toastType?: 'new_device' | 'reconnected';
}

interface Props {
    device: Device;
    toastType?: 'new_device' | 'reconnected';
    onBlock: (device: Device) => void;
    onInspect: (device: Device) => void;
    onDismiss: (mac: string) => void;
}


function getDeviceTypeIcon(device: Device) {
    const os = (device.os || '').toLowerCase();
    const host = (device.hostname || device.alias || '').toLowerCase();
    const vendor = (device.vendor || '').toLowerCase();

    if (
        os.includes('android') ||
        os.includes('ios') ||
        host.includes('phone') ||
        host.includes('galaxy') ||
        host.includes('iphone') ||
        host.includes('redmi') ||
        host.includes('xiaomi') ||
        host.includes('oppo') ||
        host.includes('vivo') ||
        host.includes('realme') ||
        host.includes('infinix') ||
        vendor.includes('samsung') ||
        vendor.includes('apple') ||
        vendor.includes('xiaomi')
    ) {
        return <Smartphone size={12} className="text-zinc-300" />;
    }

    if (
        os.includes('windows') ||
        os.includes('mac') ||
        os.includes('linux') ||
        host.includes('laptop') ||
        host.includes('desktop') ||
        host.includes('pc') ||
        host.includes('macbook') ||
        vendor.includes('lenovo') ||
        vendor.includes('dell') ||
        vendor.includes('hp') ||
        vendor.includes('asus') ||
        vendor.includes('acer')
    ) {
        return <Laptop size={12} className="text-zinc-300" />;
    }

    if (device.is_gateway) {
        return <Radio size={12} className="text-zinc-300" />;
    }

    return <Cpu size={12} className="text-zinc-300" />;
}

export const NewDeviceToast: FC<Props> = ({
    device,
    toastType = 'new_device',
    onBlock,
    onInspect,
    onDismiss
}) => {
    const deviceName = getResolvedDeviceName(device);
    const isReconnected = toastType === 'reconnected';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`w-full bg-[#14151a] backdrop-blur-xl border ${isReconnected ? 'border-emerald-500/20' : 'border-cyan-500/20'} rounded-xl shadow-[0_8px_20px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col text-zinc-100`}
            role="alert"
        >
            {/* Top Body Content */}
            <div className="p-3 flex flex-col gap-2">
                {/* Header: Device Icon & Title & Close Button */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {isReconnected ? (
                            <Wifi size={14} className="text-emerald-400 shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
                        ) : (
                            <div className="shrink-0 flex items-center justify-center text-zinc-300">
                                {getDeviceTypeIcon(device)}
                            </div>
                        )}
                        <span className={`text-[11px] font-semibold ${isReconnected ? 'text-emerald-400' : 'text-zinc-300'} tracking-tight truncate`}>
                            {isReconnected ? 'Terhubung Kembali' : 'Perangkat Baru Masuk'}
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={() => onDismiss(device.mac)}
                        className="size-5 rounded flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/[0.08] transition-colors outline-none shrink-0"
                        title="Tutup"
                        aria-label="Tutup Notifikasi"
                    >
                        <X size={12} />
                    </button>
                </div>

                {/* Device Info */}
                <div className="flex flex-col min-w-0 pl-0.5">
                    <span className="text-xs font-semibold text-white truncate">
                        {deviceName}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 truncate">
                        {device.ip}
                    </span>
                </div>
            </div>

            {/* Seamless Integrated Footer Action Buttons (Fused with Container) */}
            <div className="grid grid-cols-2 border-t border-white/[0.08] divide-x divide-white/[0.08] bg-white/[0.015]">
                <button
                    type="button"
                    onClick={() => {
                        onBlock(device);
                        onDismiss(device.mac);
                    }}
                    className="h-8 flex items-center justify-center gap-1.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors outline-none"
                >
                    <WifiOff size={11} className="text-rose-400 shrink-0" />
                    <span>Putus Akses</span>
                </button>

                <button
                    type="button"
                    onClick={() => {
                        onInspect(device);
                        onDismiss(device.mac);
                    }}
                    className="h-8 flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-300 hover:bg-white/[0.05] hover:text-white transition-colors outline-none"
                >
                    <ExternalLink size={11} className="text-zinc-400 shrink-0" />
                    <span>Lihat Detail</span>
                </button>
            </div>
        </motion.div>
    );
};
