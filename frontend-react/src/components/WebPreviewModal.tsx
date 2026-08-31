import { useState } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    ExternalLink,
    RefreshCw,
    Copy,
    Check,
    Globe,
    ShieldAlert
} from 'lucide-react';
import { Device } from '../types';
import { getResolvedDeviceName } from '../lib/deviceSort';

interface Props {
    isOpen: boolean;
    device: Device | null;
    port: number;
    onClose: () => void;
}

export const WebPreviewModal: FC<Props> = ({
    isOpen,
    device,
    port,
    onClose
}) => {
    const [iframeKey, setIframeKey] = useState<number>(0);
    const [copied, setCopied] = useState<boolean>(false);

    if (!isOpen || !device) return null;

    const protocol = port === 443 || port === 8443 ? 'https' : 'http';
    const targetUrl = `${protocol}://${device.ip}:${port}`;
    const devName = getResolvedDeviceName(device);

    const handleCopy = () => {
        navigator.clipboard.writeText(targetUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const handleReload = () => {
        setIframeKey(prev => prev + 1);
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-4xl bg-[#090a0c] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[80vh] max-h-[720px]"
                >
                    {/* Header & Simulated Browser Address Bar */}
                    <div className="px-5 py-3.5 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
                        {/* Device Info */}
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="size-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                                <Globe size={14} />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-white truncate max-w-[200px]">
                                        {devName}
                                    </span>
                                    <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-zinc-400">
                                        Port {port}
                                    </span>
                                </div>
                                <span className="text-[10px] text-zinc-400 truncate">
                                    {device.web_title ? `Title: "${device.web_title}"` : (device.web_server ? `Server: ${device.web_server}` : 'Live Web Preview')}
                                </span>
                            </div>
                        </div>

                        {/* Address Bar */}
                        <div className="flex-1 max-w-md hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/50 border border-white/[0.06] text-xs font-mono text-zinc-300">
                            <span className="text-emerald-400 font-semibold text-[11px]">{protocol}://</span>
                            <span className="truncate text-white">{device.ip}:{port}</span>
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="ml-auto text-zinc-400 hover:text-white transition-colors"
                                title="Salin URL"
                            >
                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                            </button>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={handleReload}
                                className="size-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 hover:text-white flex items-center justify-center transition-colors outline-none"
                                title="Muat ulang pratinjau"
                            >
                                <RefreshCw size={13} />
                            </button>

                            <a
                                href={targetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                                title="Buka di tab browser baru"
                            >
                                <span>Buka Tab Baru</span>
                                <ExternalLink size={12} className="text-zinc-400" />
                            </a>

                            <button
                                type="button"
                                onClick={onClose}
                                className="size-8 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 hover:text-rose-300 border border-white/[0.08] text-zinc-400 flex items-center justify-center transition-colors outline-none ml-1"
                                title="Tutup pratinjau"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </div>

                    {/* Iframe Container */}
                    <div className="flex-1 w-full h-full relative bg-black/40 overflow-hidden flex flex-col">
                        <iframe
                            key={iframeKey}
                            src={targetUrl}
                            title={`Web Preview ${targetUrl}`}
                            className="w-full h-full border-0"
                            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                        />

                        {/* Security notice footer bar */}
                        <div className="px-4 py-2 border-t border-white/[0.06] bg-[#0c0d10] flex items-center justify-between text-[11px] text-zinc-400 shrink-0">
                            <div className="flex items-center gap-1.5">
                                <ShieldAlert size={12} className="text-amber-400" />
                                <span>Beberapa router memblokir tampilan iframe (*X-Frame-Options*). Jika layar kosong, klik tombol <strong>Buka Tab Baru</strong>.</span>
                            </div>
                            <span className="font-mono text-zinc-500 text-[10px]">
                                {targetUrl}
                            </span>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
