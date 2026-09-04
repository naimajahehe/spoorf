import React, { useState, useEffect, useMemo } from 'react';
import type { FC } from 'react';
import {
    ShieldCheck,
    Gauge,
    Copy,
    Check,
    Trash2,
    Power,
    Tag,
    Activity,
    Lock,
    Sliders,
    X,
    Radio,
    Info,
    Fingerprint,
    Link2,
    RotateCw
} from 'lucide-react';
import { Device, AuthStatusResponse } from '../types';
import { TelemetryData } from '../hooks/useWebSocket';
import { RangeSlider } from './motion/RangeSlider';
import { BouncyAccordion, BouncyAccordionItem } from './motion/bouncy-accordion';
import { NetworkBandwidthLineChart, BandwidthDataPoint } from './NetworkBandwidthLineChart';
import { InstagramIcon } from './icons/InstagramIcon';
import { getResolvedDeviceName } from '../lib/deviceSort';
import { cn } from '../lib/utils';

interface SecurityTelemetrySidebarProps {
    device: Device;
    telemetry?: TelemetryData;
    onClose: () => void;
    onSetSpeedLimit?: (ip: string, limit: number) => void;
    onUpdateAlias?: (mac: string, alias: string) => void;
    onToggleInternet?: (device: Device) => void;
    onDeleteDevice?: (mac: string) => void;
    onOpenRedirectModal?: (device: Device) => void;
    onRefresh?: () => Promise<void> | void;
    isRefreshing?: boolean;
    isLoading?: boolean;
    authStatus?: AuthStatusResponse;
    onOpenUpgradeModal?: (reason?: string) => void;
    className?: string;
}

export const SecurityTelemetrySidebar: FC<SecurityTelemetrySidebarProps> = ({
    device,
    telemetry,
    onClose,
    onSetSpeedLimit,
    onUpdateAlias,
    onToggleInternet,
    onDeleteDevice,
    onOpenRedirectModal,
    onRefresh,
    isRefreshing = false,
    isLoading = false,
    authStatus,
    onOpenUpgradeModal,
    className
}) => {
    const [aliasInput, setAliasInput] = useState('');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [bandwidthHistory, setBandwidthHistory] = useState<BandwidthDataPoint[]>([]);

    useEffect(() => {
        setAliasInput(device.alias || '');
    }, [device.mac, device.alias]);

    useEffect(() => {
        if (!telemetry) return;
        const now = telemetry.timestamp || Date.now();
        const newPoint: BandwidthDataPoint = {
            time: now,
            label: 'Now',
            download: telemetry.download ?? 0,
            upload: telemetry.upload ?? 0
        };
        setBandwidthHistory(prev => {
            const next = [...prev, newPoint].slice(-10);
            return next.map((p, idx, arr) => {
                const diffSec = arr.length - 1 - idx;
                return {
                    ...p,
                    label: diffSec === 0 ? 'Now' : `-${diffSec}s`
                };
            });
        });
    }, [telemetry?.timestamp, telemetry?.download, telemetry?.upload]);

    const handleCopy = (key: string, text: string, e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1800);
    };

    const deviceName = getResolvedDeviceName(device);

    const isOnline = device.is_self ? true : device.is_online;
    const isInternetActive = !device.is_blocked && (device.speed_limit === undefined || device.speed_limit > 0);
    const ttlValue = device.ttl || (device.os === 'Windows' ? 128 : 64);
    const ttlDesc = ttlValue >= 100 ? 'Windows NT' : ttlValue <= 75 ? 'Linux / Android / Darwin' : 'Network Appliance';
    const isThrottled = (device.speed_limit ?? 100) > 0 && (device.speed_limit ?? 100) < 100;
    const speedLimit = device.speed_limit ?? 100;

    const throttleTheme = useMemo(() => {
        if (speedLimit === 0) {
            return {
                text: 'text-rose-400',
                border: 'border-rose-500/30',
                badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
                sliderFill: 'bg-rose-500/40',
                dot: 'bg-rose-500',
                label: 'Cut Off (0%)'
            };
        }
        if (speedLimit <= 25) {
            return {
                text: 'text-rose-400',
                border: 'border-rose-500/30',
                badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
                sliderFill: 'bg-rose-500/40',
                dot: 'bg-rose-500',
                label: `Heavy Throttle (${speedLimit}%)`
            };
        }
        if (speedLimit <= 60) {
            return {
                text: 'text-amber-400',
                border: 'border-amber-500/30',
                badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                sliderFill: 'bg-amber-500/40',
                dot: 'bg-amber-400',
                label: `Medium Throttle (${speedLimit}%)`
            };
        }
        if (speedLimit < 100) {
            return {
                text: 'text-yellow-400',
                border: 'border-yellow-500/30',
                badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
                sliderFill: 'bg-yellow-500/40',
                dot: 'bg-yellow-400',
                label: `Light Throttle (${speedLimit}%)`
            };
        }
        return {
            text: 'text-emerald-400',
            border: 'border-emerald-500/30',
            badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
            sliderFill: 'bg-emerald-500/30',
            dot: 'bg-emerald-400',
            label: 'Full Speed (100%)'
        };
    }, [speedLimit]);

    const accordionItems: BouncyAccordionItem[] = useMemo(() => [
        // Sub-menu 1: Pemantauan Jaringan
        {
            id: 'network-telemetry',
            title: 'Pemantauan Jaringan',
            subtitle: 'Network Telemetry & Link Pulse',
            icon: <Activity size={16} className="text-zinc-400" />,
            content: (
                <div className="space-y-2.5 pt-1">
                    {/* Live Line Chart 10s Window (Bklit UI Style) */}
                    <NetworkBandwidthLineChart
                        history={bandwidthHistory}
                        currentDownload={telemetry?.download ?? 0}
                        currentUpload={telemetry?.upload ?? 0}
                        latency={device.rtt_ms ?? telemetry?.latency}
                    />

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">Ping & Stack TTL</span>
                        <div className="flex items-center gap-1.5 font-mono text-zinc-200 text-[11px]">
                            <span className="text-emerald-400 font-semibold">{device.rtt_ms != null ? `${device.rtt_ms} ms` : '<1 ms'}</span>
                            <span className="text-zinc-600">|</span>
                            <span>TTL {ttlValue}</span>
                        </div>
                    </div>
                    <div className="text-[10px] font-mono text-zinc-500 text-right -mt-1">{ttlDesc}</div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">Link Pulse State</span>
                        <span className="font-mono text-[11px] flex items-center gap-1.5">
                            {device.is_blocked ? (
                                <>
                                    <span className="size-1.5 rounded-full inline-block bg-rose-500 animate-pulse" />
                                    <span className="text-rose-400 font-medium">Terputus (Blocked)</span>
                                </>
                            ) : device.is_redirected ? (
                                <>
                                    <span className="size-1.5 rounded-full inline-block bg-pink-400 animate-pulse" />
                                    <span className="text-pink-300 font-medium">Redirected (IG)</span>
                                </>
                            ) : isThrottled ? (
                                <>
                                    <span className={cn("size-1.5 rounded-full inline-block", throttleTheme.dot)} />
                                    <span className={cn("font-medium", throttleTheme.text)}>Throttled ({device.speed_limit}%)</span>
                                </>
                            ) : isOnline ? (
                                <>
                                    <span className="size-1.5 rounded-full inline-block bg-emerald-400 animate-pulse" />
                                    <span className="text-zinc-200">Responsive (Connected)</span>
                                </>
                            ) : (
                                <>
                                    <span className="size-1.5 rounded-full inline-block bg-zinc-600" />
                                    <span className="text-zinc-500">Unreachable (Timeout)</span>
                                </>
                            )}
                        </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">ARP Poison Guard</span>
                        <span className="font-mono text-emerald-400 text-[11px] flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                            Active
                        </span>
                    </div>
                </div>
            )
        },

        // Sub-menu 2: Informasi Perangkat
        {
            id: 'device-info',
            title: 'Informasi Perangkat',
            subtitle: 'Device Intelligence & L2 Profile',
            icon: <Info size={16} className="text-zinc-400" />,
            trailingIcon: authStatus?.license?.tier === 'free' ? <Lock size={13} className="text-zinc-500" /> : undefined,
            content: authStatus?.license?.tier === 'free' ? (
                <div className="py-3 px-1 text-center space-y-2">
                    <div className="size-7 mx-auto rounded-full bg-white/[0.04] flex items-center justify-center text-zinc-400">
                        <Lock size={13} />
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-xs font-medium text-zinc-200 block">Informasi Perangkat Terkunci</span>
                        <span className="text-[11px] text-zinc-500 block leading-relaxed max-w-[240px] mx-auto">
                            Deteksi OS mendalam, riwayat MAC acak, dan profil sidik jari DHCP khusus pengguna PRO.
                        </span>
                    </div>
                    {onOpenUpgradeModal && (
                        <button
                            type="button"
                            onClick={() => onOpenUpgradeModal('Buka analisis informasi perangkat dan deteksi OS mendalam dengan upgrade ke PRO.')}
                            className="px-3 py-1 rounded-full text-[11px] font-mono text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-all cursor-pointer inline-flex items-center gap-1 mt-0.5"
                        >
                            <span>Upgrade ke PRO</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400">IPv4 Address</span>
                        <div className="flex items-center gap-1.5 font-mono text-zinc-200 text-[11px]">
                            <span>{device.ip}</span>
                            <button
                                type="button"
                                onClick={(e) => handleCopy(`ip-${device.ip}`, device.ip, e)}
                                className="text-zinc-500 hover:text-white transition-colors"
                                title="Copy IP"
                            >
                                {copiedKey === `ip-${device.ip}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                            </button>
                        </div>
                    </div>

                    {device.ipv6_link_local && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                            <span className="text-zinc-400">IPv6 Link-Local</span>
                            <div className="flex items-center gap-1.5 font-mono text-white text-[10px]">
                                <span className="truncate max-w-[130px]" title={device.ipv6_link_local}>{device.ipv6_link_local}</span>
                                <button
                                    type="button"
                                    onClick={(e) => handleCopy(`ipv6-ll-${device.mac}`, device.ipv6_link_local || '', e)}
                                    className="text-zinc-500 hover:text-white transition-colors"
                                    title="Copy IPv6 Link-Local"
                                >
                                    {copiedKey === `ipv6-ll-${device.mac}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {device.ipv6_global && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                            <span className="text-zinc-400">IPv6 Global (SLAAC)</span>
                            <div className="flex items-center gap-1.5 font-mono text-white text-[10px]">
                                <span className="truncate max-w-[130px]" title={device.ipv6_global}>{device.ipv6_global}</span>
                                <button
                                    type="button"
                                    onClick={(e) => handleCopy(`ipv6-glob-${device.mac}`, device.ipv6_global || '', e)}
                                    className="text-zinc-500 hover:text-white transition-colors"
                                    title="Copy IPv6 Global"
                                >
                                    {copiedKey === `ipv6-glob-${device.mac}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">MAC Layer 2</span>
                        <div className="flex items-center gap-1.5 font-mono text-zinc-200 text-[11px]">
                            <span className="truncate max-w-[140px]">{device.mac}</span>
                            <button
                                type="button"
                                onClick={(e) => handleCopy(`mac-${device.mac}`, device.mac, e)}
                                className="text-zinc-500 hover:text-white transition-colors"
                                title="Copy MAC"
                            >
                                {copiedKey === `mac-${device.mac}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">MAC Architecture</span>
                        <div>
                            {device.is_randomized_mac ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-purple-300">
                                    <span className="size-1.5 rounded-full bg-purple-400 shrink-0" />
                                    Private MAC
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-blue-300">
                                    <span className="size-1.5 rounded-full bg-blue-400 shrink-0" />
                                    Hardware OUI
                                </span>
                            )}
                        </div>
                    </div>

                    {device.linked_macs && device.linked_macs.length > 1 && (
                        <div className="pt-2 pb-1 border-t border-white/[0.04] space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400 flex items-center gap-1">
                                    <Link2 size={11} className="text-purple-400" />
                                    Riwayat MAC Acak
                                </span>
                                <span className="text-[10px] font-mono text-purple-400">
                                    {device.linked_macs.length} Terhubung
                                </span>
                            </div>
                            <div className="space-y-1 max-h-[100px] overflow-y-auto pr-1">
                                {device.linked_macs.map((m) => {
                                    const isCurrent = m.toLowerCase() === device.mac.toLowerCase();
                                    return (
                                        <div key={m} className="flex items-center justify-between text-[10px] font-mono py-0.5">
                                            <span className={isCurrent ? "text-purple-300 font-medium" : "text-zinc-500"}>{m}</span>
                                            <span className={cn("text-[9px] uppercase tracking-wider", isCurrent ? "text-purple-400" : "text-zinc-600")}>
                                                {isCurrent ? "Aktif" : "Diarsipkan"}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">Vendor & Model</span>
                        <span className="font-mono text-zinc-200 text-[11px] truncate max-w-[160px] text-right" title={device.vendor}>
                            {device.vendor || 'Unknown Hardware'}
                        </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">Sistem Operasi</span>
                        <span className="font-mono text-zinc-200 text-[11px] truncate max-w-[160px] text-right" title={device.os}>
                            {device.os || 'Unknown OS'}
                        </span>
                    </div>

                    {/* Estimasi Jarak & Proximity Sensor */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400 flex items-center gap-1">
                            <Radio size={11} className="text-zinc-400" />
                            Estimasi Jarak
                        </span>
                        <span className="font-mono text-[11px] text-zinc-200 flex items-center gap-1.5">
                            <span className={cn(
                                "size-1.5 rounded-full inline-block",
                                device.is_self ? "bg-emerald-400" :
                                device.distance_zone === 'near' ? "bg-emerald-400" :
                                device.distance_zone === 'medium' ? "bg-amber-400" :
                                device.distance_zone === 'far' ? "bg-rose-400" : "bg-zinc-500"
                            )} />
                            <span>
                                {device.is_self ? 'Dekat (~0 - 1m)' :
                                 device.distance_zone === 'near' ? `Dekat (${device.estimated_range || '~1 - 3m'})` :
                                 device.distance_zone === 'medium' ? `Sedang (${device.estimated_range || '~4 - 8m'})` :
                                 device.distance_zone === 'far' ? `Jauh (${device.estimated_range || '> 10m'})` :
                                 'Sedang (~4 - 8m)'}
                            </span>
                        </span>
                    </div>

                    {/* Passive DHCP Intelligence (Teknik 3B) */}
                    {device.dhcp_fingerprint && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                            <span className="text-zinc-400 flex items-center gap-1">
                                <Fingerprint size={11} className="text-cyan-400" />
                                OS Signature (Opt 55)
                            </span>
                            <span className="text-[11px] font-mono text-cyan-300 truncate max-w-[160px]" title={device.dhcp_fingerprint}>
                                {device.dhcp_fingerprint}
                            </span>
                        </div>
                    )}

                    {device.dhcp_vendor_class && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                            <span className="text-zinc-400">Vendor Class (Opt 60)</span>
                            <span className="font-mono text-[11px] text-zinc-300 truncate max-w-[150px]" title={device.dhcp_vendor_class}>
                                {device.dhcp_vendor_class}
                            </span>
                        </div>
                    )}

                    {device.dhcp_client_id && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                            <span className="text-zinc-400">Hardware DUID (Opt 61)</span>
                            <div className="flex items-center gap-1 font-mono text-[10px] text-zinc-400">
                                <span className="truncate max-w-[120px]" title={device.dhcp_client_id}>{device.dhcp_client_id}</span>
                                <button
                                    type="button"
                                    onClick={(e) => handleCopy(`duid-${device.mac}`, device.dhcp_client_id || '', e)}
                                    className="text-zinc-500 hover:text-white transition-colors"
                                    title="Copy DUID"
                                >
                                    {copiedKey === `duid-${device.mac}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {device.dhcp_fqdn && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                            <span className="text-zinc-400">FQDN (Opt 81)</span>
                            <span className="font-mono text-[10px] text-zinc-300 truncate max-w-[150px]" title={device.dhcp_fqdn}>
                                {device.dhcp_fqdn}
                            </span>
                        </div>
                    )}
                </div>
            )
        },

        // Sub-menu 2: Bandwidth Throttle
        {
            id: 'bandwidth-throttle',
            title: 'Bandwidth Throttle',
            subtitle: 'Pembatas Kecepatan Bandwidth',
            icon: <Gauge size={16} className="text-zinc-400" />,
            trailingIcon: authStatus?.license?.tier === 'free' ? <Lock size={13} className="text-zinc-500" /> : undefined,
            content: authStatus?.license?.tier === 'free' ? (
                <div className="py-3 px-1 text-center space-y-2">
                    <div className="size-7 mx-auto rounded-full bg-white/[0.04] flex items-center justify-center text-zinc-400">
                        <Lock size={13} />
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-xs font-medium text-zinc-200 block">Bandwidth Throttle Terkunci</span>
                        <span className="text-[11px] text-zinc-500 block leading-relaxed max-w-[240px] mx-auto">
                            Fitur pembatasan kecepatan bandwidth presisi (PWM Bandwidth Shaper 0% - 99%) khusus untuk pengguna PRO.
                        </span>
                    </div>
                    {onOpenUpgradeModal && (
                        <button
                            type="button"
                            onClick={() => onOpenUpgradeModal('Fitur Bandwidth Throttling khusus untuk pengguna PRO. Upgrade untuk mengatur batas kecepatan!')}
                            className="px-3 py-1 rounded-full text-[11px] font-mono text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-all cursor-pointer inline-flex items-center gap-1 mt-0.5"
                        >
                            <span>Upgrade ke PRO</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3 pt-1">
                    {!device.is_self && !device.is_gateway ? (
                        <>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Target Speed Cap</span>
                                <span className={cn("font-mono text-[11px] font-semibold flex items-center gap-1.5", throttleTheme.text)}>
                                    <span className={cn("size-1.5 rounded-full inline-block", throttleTheme.dot)} />
                                    {throttleTheme.label}
                                </span>
                            </div>

                            {/* Range Slider */}
                            <div className="pt-1 pb-1">
                                <RangeSlider
                                    value={device.speed_limit ?? 100}
                                    onValueChange={(val) => {
                                        if (val > 0 && val < 100 && authStatus?.license?.tier === 'free') {
                                            onOpenUpgradeModal?.('Fitur Bandwidth Throttling khusus untuk pengguna PRO. Upgrade untuk mengatur batas kecepatan!');
                                            return;
                                        }
                                        if (onSetSpeedLimit) {
                                            onSetSpeedLimit(device.ip, val);
                                        }
                                    }}
                                    min={0}
                                    max={100}
                                    step={25}
                                    showTicks={true}
                                    className="h-7 bg-black/40 border-white/[0.08]"
                                    fillClassName={throttleTheme.sliderFill}
                                />
                            </div>

                            {/* Segmented Quick Presets */}
                            <div className="flex items-center rounded-lg bg-black/40 p-0.5 text-[10px] font-mono border border-white/[0.06]">
                                {[
                                    { label: '0%', val: 0, title: 'Cut Off (Block)' },
                                    { label: '25%', val: 25, title: 'Heavy (~128 Kbps)' },
                                    { label: '50%', val: 50, title: 'Medium (~512 Kbps)' },
                                    { label: '100%', val: 100, title: 'Full Speed' }
                                ].map(preset => {
                                    const isSelected = (device.speed_limit ?? 100) === preset.val;
                                    return (
                                        <button
                                            key={preset.val}
                                            type="button"
                                            onClick={() => {
                                                if (preset.val > 0 && preset.val < 100 && authStatus?.license?.tier === 'free') {
                                                    onOpenUpgradeModal?.('Fitur Bandwidth Throttling khusus untuk pengguna PRO.');
                                                    return;
                                                }
                                                onSetSpeedLimit && onSetSpeedLimit(device.ip, preset.val);
                                            }}
                                            className={cn(
                                                "flex-1 py-1 rounded-md transition-all text-center select-none",
                                                isSelected
                                                    ? cn(
                                                        "font-semibold shadow-sm",
                                                        preset.val === 0 || preset.val === 25 ? "bg-rose-500/20 text-rose-300" :
                                                        preset.val === 50 ? "bg-amber-500/20 text-amber-300" :
                                                        "bg-emerald-500/20 text-emerald-300"
                                                      )
                                                    : "text-zinc-500 hover:text-zinc-300"
                                            )}
                                            title={preset.title}
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    ) : device.is_gateway ? (
                        <div className="py-2 flex items-start gap-2.5 text-xs text-zinc-400">
                            <ShieldCheck className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                                <span className="text-zinc-200 font-medium block text-xs">Gateway Protected Node</span>
                                <span className="text-[11px] text-zinc-500 block leading-relaxed">
                                    Simpul router inti dilindungi permanen dari pemotongan kecepatan.
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="py-2 flex items-start gap-2.5 text-xs text-zinc-400">
                            <Lock className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                                <span className="text-zinc-200 font-medium block text-xs">Host Operator</span>
                                <span className="text-[11px] text-zinc-500 block leading-relaxed">
                                    Laptop ini adalah kontroler sistem dan terlindungi dari isolasi.
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )
        },

        // Sub-menu 3: Status & Keamanan
        {
            id: 'access-status',
            title: 'Status & Keamanan',
            subtitle: 'Access Gate & Killswitch',
            icon: <ShieldCheck size={16} className="text-zinc-400" />,
            content: (
                <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400">Connection State</span>
                        <div className="flex items-center gap-1.5">
                            {device.is_blocked ? (
                                <>
                                    <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
                                    <span className="text-xs font-mono font-medium text-rose-400">Terblokir (Cut-off)</span>
                                </>
                            ) : device.is_redirected ? (
                                <>
                                    <span className="size-2 rounded-full bg-pink-400 animate-pulse" />
                                    <span className="text-xs font-mono font-medium text-pink-300">Redirect (IG)</span>
                                </>
                            ) : isThrottled ? (
                                <>
                                    <span className={cn("size-2 rounded-full", throttleTheme.dot)} />
                                    <span className={cn("text-xs font-mono font-medium", throttleTheme.text)}>Dibatasi ({device.speed_limit}%)</span>
                                </>
                            ) : isOnline ? (
                                <>
                                    <span className="size-2 rounded-full bg-emerald-400" />
                                    <span className="text-xs font-mono font-medium text-zinc-200">Online</span>
                                </>
                            ) : (
                                <>
                                    <span className="size-2 rounded-full bg-zinc-600" />
                                    <span className="text-xs font-mono font-medium text-zinc-500">Offline</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/[0.04]">
                        <span className="text-zinc-400">Host Role</span>
                        <span className="font-mono text-zinc-200 text-[11px]">
                            {device.is_gateway ? "Gateway Router" : device.is_self ? "This Machine" : "LAN Client"}
                        </span>
                    </div>

                    {/* Primary Action Button */}
                    {!device.is_gateway && !device.is_self && onToggleInternet && (
                        <button
                            type="button"
                            onClick={() => onToggleInternet(device)}
                            disabled={isLoading}
                            className={cn(
                                "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-mono font-medium transition-all border mt-2",
                                isThrottled
                                    ? cn("border", throttleTheme.badge, "hover:opacity-90")
                                    : isInternetActive
                                        ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/15"
                                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"
                            )}
                        >
                            <Power size={12} />
                            <span>
                                {isThrottled ? 'Restore Full Speed (100%)' : isInternetActive ? 'Cut Off Internet Access' : 'Restore Internet Access'}
                            </span>
                        </button>
                    )}

                    {/* Instagram Redirect Button */}
                    {!device.is_gateway && !device.is_self && onOpenRedirectModal && (
                        <button
                            type="button"
                            onClick={() => onOpenRedirectModal(device)}
                            className={cn(
                                "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-mono font-medium transition-all border mt-1.5",
                                device.is_redirected
                                    ? "bg-pink-500/20 text-pink-300 border-pink-500/30 hover:bg-pink-500/25"
                                    : "bg-white/[0.04] text-zinc-300 border-white/[0.08] hover:text-pink-300 hover:border-pink-500/30 hover:bg-pink-500/10"
                            )}
                        >
                            <InstagramIcon size={12} className={device.is_redirected ? "text-pink-400" : ""} />
                            <span>
                                {device.is_redirected ? 'Kelola Redirect Instagram' : 'Alihkan ke Instagram'}
                            </span>
                        </button>
                    )}

                    <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                        <button
                            type="button"
                            onClick={(e) => {
                                const specs = `Device: ${deviceName}\nIP: ${device.ip}\nMAC: ${device.mac} (${device.is_randomized_mac ? 'Private MAC' : 'Hardware MAC'})\nVendor: ${device.vendor || 'Unknown'}\nType: ${device.device_type || 'Network Device'}\nOS: ${device.os || 'Unknown'}${device.dhcp_fingerprint ? `\nDHCP Signature: ${device.dhcp_fingerprint}` : ''}${device.dhcp_vendor_class ? `\nVendor Class: ${device.dhcp_vendor_class}` : ''}${device.dhcp_client_id ? `\nDUID: ${device.dhcp_client_id}` : ''}\nTTL: ${ttlValue} (${ttlDesc})\nPing: ${device.rtt_ms || '<1'} ms\nStatus: ${isOnline ? 'Online' : 'Offline'}\nAccess: ${isInternetActive ? 'Active' : 'Blocked'}`;
                                handleCopy(`specs-${device.ip}`, specs, e);
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
                        >
                            {copiedKey === `specs-${device.ip}` ? (
                                <>
                                    <Check size={11} className="text-emerald-400" />
                                    <span className="text-emerald-400 text-[11px]">Copied!</span>
                                </>
                            ) : (
                                <>
                                    <Copy size={11} />
                                    <span className="text-[11px]">Copy Specs</span>
                                </>
                            )}
                        </button>

                        {!device.is_gateway && !device.is_self && onDeleteDevice && (
                            <button
                                type="button"
                                onClick={() => onDeleteDevice(device.mac)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5"
                                title="Hapus riwayat perangkat"
                            >
                                <Trash2 size={11} />
                                <span className="text-[11px]">Forget</span>
                            </button>
                        )}
                    </div>
                </div>
            )
        },

        // Sub-menu 4: Pengaturan Target
        {
            id: 'target-settings',
            title: 'Pengaturan Target',
            subtitle: 'Profile & Custom Alias',
            icon: <Sliders size={16} className="text-zinc-400" />,
            content: (
                <div className="space-y-2.5 pt-1">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Tag size={11} className="text-zinc-400" />
                        Custom Alias / Label
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={aliasInput}
                            onChange={(e) => setAliasInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && onUpdateAlias) {
                                    onUpdateAlias(device.mac, aliasInput.trim());
                                }
                            }}
                            placeholder="Beri nama alias target..."
                            className="flex-1 bg-black/40 border border-white/[0.08] focus:border-white/[0.2] rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 outline-none transition-colors"
                        />
                        <button
                            type="button"
                            onClick={() => onUpdateAlias && onUpdateAlias(device.mac, aliasInput.trim())}
                            className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 transition-colors shrink-0"
                        >
                            Save
                        </button>
                    </div>

                    {device.matched_by === 'hostname_fingerprint' && (
                        <div className="text-[10px] font-mono text-amber-400/90 flex items-center gap-1.5 pt-1">
                            <span className="size-1.5 rounded-full bg-amber-400 inline-block animate-pulse shrink-0" />
                            <span>Auto-merged via Hostname Fingerprint</span>
                        </div>
                    )}

                    {device.matched_by === 'duid_fingerprint' && (
                        <div className="text-[10px] font-mono text-cyan-400/90 flex items-center gap-1.5 pt-1">
                            <span className="size-1.5 rounded-full bg-cyan-400 inline-block animate-pulse shrink-0" />
                            <span>Auto-reblocked via Hardware DUID (Anti-Randomization)</span>
                        </div>
                    )}
                </div>
            )
        }
    ], [device, deviceName, ttlValue, ttlDesc, isOnline, isInternetActive, isThrottled, aliasInput, copiedKey, isLoading, onSetSpeedLimit, onUpdateAlias, onToggleInternet, onDeleteDevice, authStatus, onOpenUpgradeModal, bandwidthHistory, telemetry]);

    return (
        <aside className={cn(
            "w-full xl:w-[320px] shrink-0 bg-[#090a0c] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl flex flex-col",
            className
        )}>
            {/* Header with Title and Close Button (No Shield Icon) */}
            <div className="px-4 py-3.5 border-b border-white/[0.06] bg-white/[0.015] flex items-center justify-between gap-3 relative z-30">
                <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-white tracking-tight uppercase">Security & Telemetry</h3>
                    <div className="flex items-center gap-1.5 mt-0.5 truncate">
                        <span className={cn("size-1.5 rounded-full shrink-0", isOnline ? "bg-emerald-400" : "bg-zinc-600")} />
                        <p className="text-[11px] font-mono text-zinc-300 truncate font-medium">{deviceName}</p>
                        <span className="text-zinc-600 text-[10px]">•</span>
                        <span className="text-[10px] font-mono text-zinc-500 truncate">{device.ip}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {/* Telemetry Refresh / Sync Button (Clean unboxed style) */}
                    <button
                        type="button"
                        onClick={() => onRefresh && onRefresh()}
                        disabled={isRefreshing}
                        className={cn(
                            "h-7 px-1 text-zinc-400 hover:text-white flex items-center gap-1.5 text-[11px] font-mono transition-colors outline-none cursor-pointer",
                            isRefreshing && "opacity-80 cursor-wait text-zinc-300"
                        )}
                        title="Perbarui telemetry"
                    >
                        {isRefreshing ? (
                            <>
                                <div className="size-3 shrink-0 flex items-center justify-center">
                                    <svg viewBox="0 0 24 24" className="size-3 animate-spin shrink-0">
                                        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-700" />
                                        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="60" strokeDashoffset="42" className="text-zinc-200" />
                                    </svg>
                                </div>
                                <span>Sync</span>
                            </>
                        ) : (
                            <>
                                <RotateCw size={12} className="text-zinc-400" />
                                <span>Sync</span>
                            </>
                        )}
                    </button>

                    {/* Close Button (Clean unboxed style) */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose();
                        }}
                        className="size-7 text-zinc-400 hover:text-white flex items-center justify-center transition-colors shrink-0 outline-none cursor-pointer"
                        title="Tutup panel inspeksi"
                        aria-label="Tutup panel inspeksi"
                    >
                        <X size={15} />
                    </button>
                </div>
            </div>

            {/* Smooth Scrollable Content Viewport (Native scroll without PullToRefresh loading) */}
            <div className="flex-1 overflow-y-auto max-h-[720px] overscroll-y-contain">
                {/* Bouncy Accordion for the Sub-menus (Clean Directory style, closed by default) */}
                <BouncyAccordion
                    items={accordionItems}
                    defaultValue={null}
                    collapsible={true}
                    variant="clean"
                />
            </div>
        </aside>
    );
};
