import React from 'react';
import { SiAndroid, SiApple, SiLinux, SiUbuntu, SiDebian, SiRaspberrypi } from 'react-icons/si';
import { BsWindows } from 'react-icons/bs';
import { Router, Laptop, Smartphone, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export interface DeviceOsBadgeProps {
    os?: string | null;
    vendor?: string | null;
    deviceType?: string | null;
    isGateway?: boolean;
    isSelf?: boolean;
    className?: string;
    iconSize?: number;
    showLabel?: boolean;
    textClassName?: string;
}

/**
 * Membersihkan dan menstandarisasi nama OS:
 * - Menghilangkan "Android / Linux" -> "Android"
 * - Menghilangkan "Android OS" -> "Android"
 * - Merapikan "Linux / RouterOS" -> "RouterOS"
 */
export function formatDeviceOs(os?: string | null, isGateway?: boolean, vendor?: string | null): string {
    if (isGateway) {
        if (os && os.toLowerCase().includes('routeros')) return 'RouterOS';
        return 'RouterOS';
    }

    if (!os || os.trim() === '' || os === '-' || os.toLowerCase().includes('unknown')) {
        return vendor && vendor.trim() !== '' && !vendor.toLowerCase().includes('unknown') 
            ? vendor 
            : 'Unknown OS';
    }

    const trimmed = os.trim();
    const lower = trimmed.toLowerCase();

    // Android: hilangkan kata Linux jika ada
    if (lower.includes('android')) {
        if (lower.includes('14')) return 'Android 14';
        if (lower.includes('13')) return 'Android 13';
        if (lower.includes('12')) return 'Android 12';
        if (lower.includes('11')) return 'Android 11';
        return 'Android';
    }

    // Windows
    if (lower.includes('windows')) {
        if (lower.includes('11')) return 'Windows 11';
        if (lower.includes('10')) return 'Windows 10';
        if (lower.includes('server')) return 'Windows Server';
        return 'Windows';
    }

    // Apple
    if (lower.includes('ios')) return 'iOS';
    if (lower.includes('macos') || lower.includes('mac os')) return 'macOS';
    if (lower.includes('apple')) return 'Apple Darwin';

    // Linux Distros
    if (lower.includes('ubuntu')) return 'Ubuntu';
    if (lower.includes('debian')) return 'Debian';
    if (lower.includes('raspberry') || lower.includes('raspbian')) return 'Raspberry Pi OS';
    if (lower.includes('linux')) return 'Linux';

    return trimmed;
}

export const DeviceOsBadge: React.FC<DeviceOsBadgeProps> = ({
    os,
    vendor,
    deviceType,
    isGateway,
    isSelf,
    className,
    iconSize = 13,
    showLabel = true,
    textClassName,
}) => {
    const rawLower = (os || '').toLowerCase();
    const vendorLower = (vendor || '').toLowerCase();
    const typeLower = (deviceType || '').toLowerCase();
    const resolvedLabel = formatDeviceOs(os, isGateway, vendor);

    // 1. Gateway / Router
    if (isGateway || rawLower.includes('router') || typeLower.includes('router') || typeLower.includes('gateway')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={`Gateway Router (${resolvedLabel})`}>
                <Router size={iconSize} className="text-cyan-400 shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 2. Android (Ciri khas: Hijau #3DDC84 / emerald-400)
    if (
        rawLower.includes('android') ||
        (['samsung', 'xiaomi', 'oppo', 'vivo', 'realme', 'infinix', 'tecno', 'oneplus', 'huawei'].some(b => vendorLower.includes(b)) && !rawLower.includes('windows'))
    ) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={`Perangkat Android (${resolvedLabel})`}>
                <SiAndroid size={iconSize} className="text-[#3DDC84] shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel === 'Unknown OS' ? 'Android' : resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 3. Windows (Ciri khas: Biru #0078D4 / sky-400)
    if (rawLower.includes('windows') || (isSelf && rawLower.includes('win'))) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={`Microsoft Windows (${resolvedLabel})`}>
                <BsWindows size={iconSize} className="text-[#0078D4] shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 4. Apple iOS / macOS (Ciri khas: Silver / Putih zinc-200)
    if (rawLower.includes('ios') || rawLower.includes('macos') || rawLower.includes('apple') || vendorLower.includes('apple')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={`Apple (${resolvedLabel})`}>
                <SiApple size={iconSize} className="text-zinc-200 shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 5. Linux Distros & Kernels (Ciri khas: Amber / Kuning #FCC624)
    if (rawLower.includes('ubuntu')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title="Ubuntu Linux">
                <SiUbuntu size={iconSize} className="text-[#E95420] shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    if (rawLower.includes('debian')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title="Debian Linux">
                <SiDebian size={iconSize} className="text-[#A81D33] shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    if (rawLower.includes('raspberry') || vendorLower.includes('raspberry')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title="Raspberry Pi">
                <SiRaspberrypi size={iconSize} className="text-[#C51A4A] shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    if (rawLower.includes('linux')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title="Linux OS">
                <SiLinux size={iconSize} className="text-[#FCC624] shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-200 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 6. Generic Mobile
    if (typeLower.includes('mobile') || typeLower.includes('phone') || typeLower.includes('tablet')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={`Perangkat Mobile (${resolvedLabel})`}>
                <Smartphone size={iconSize} className="text-zinc-400 shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-300 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 7. Generic PC / Laptop
    if (typeLower.includes('pc') || typeLower.includes('laptop') || typeLower.includes('computer')) {
        return (
            <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={`Komputer PC/Laptop (${resolvedLabel})`}>
                <Laptop size={iconSize} className="text-zinc-400 shrink-0" />
                {showLabel && (
                    <span className={cn("text-xs text-zinc-300 font-medium truncate", textClassName)}>
                        {resolvedLabel}
                    </span>
                )}
            </div>
        );
    }

    // 8. Fallback / Unknown
    return (
        <div className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={resolvedLabel}>
            <HelpCircle size={iconSize} className="text-zinc-500 shrink-0" />
            {showLabel && (
                <span className={cn("text-xs text-zinc-400 font-medium truncate", textClassName)}>
                    {resolvedLabel}
                </span>
            )}
        </div>
    );
};

export default DeviceOsBadge;
