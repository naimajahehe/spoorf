import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Zap, Shield, Gauge, Radio, ExternalLink, Key } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onOpenLoginModal: () => void;
    reason?: string;
}

export const UpgradeProModal: FC<Props> = ({
    isOpen,
    onClose,
    onOpenLoginModal,
    reason
}) => {
    if (!isOpen) return null;

    const handleOpenCheckout = () => {
        window.open('https://spoorf.app/pricing', '_blank');
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/80 backdrop-blur-md"
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.94, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.94, y: 20 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="relative w-full max-w-lg bg-[#090a0c] border border-purple-500/30 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(168,85,247,0.15)] flex flex-col z-10"
                >
                    {/* Header Glowing Accent */}
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 via-emerald-400 to-indigo-500" />

                    <div className="px-6 pt-6 pb-4 border-b border-white/[0.08] flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shadow-inner">
                                <Sparkles size={20} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-bold text-white tracking-tight">
                                        Upgrade ke Spoorf Sentinel PRO
                                    </h3>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-gradient-to-r from-purple-500/30 to-indigo-500/30 text-purple-200 border border-purple-500/40">
                                        PRO PLAN
                                    </span>
                                </div>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Buka kendali penuh jaringan Wi-Fi Anda tanpa batas.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="size-8 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 hover:text-rose-300 border border-white/[0.08] text-zinc-400 flex items-center justify-center transition-colors outline-none cursor-pointer"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {/* Content Body */}
                    <div className="p-6 flex flex-col gap-5">
                        {/* Context Reason Alert if triggered by user action */}
                        {reason && (
                            <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 text-purple-200 text-xs flex items-center gap-2.5">
                                <Zap size={15} className="text-purple-400 shrink-0" />
                                <span>{reason}</span>
                            </div>
                        )}

                        {/* Feature Comparison Table */}
                        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 flex flex-col gap-3">
                            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                                Perbandingan Fitur Free vs PRO
                            </span>

                            <div className="space-y-2.5 text-xs">
                                <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                                    <span className="text-zinc-300 flex items-center gap-2">
                                        <Shield size={14} className="text-purple-400" />
                                        Batas Pemutusan Target (Cut-Off)
                                    </span>
                                    <div className="flex items-center gap-3 font-mono text-[11px]">
                                        <span className="text-zinc-500">Free: 5 target</span>
                                        <span className="text-emerald-400 font-bold">Pro: Unlimited 🚀</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                                    <span className="text-zinc-300 flex items-center gap-2">
                                        <Sparkles size={14} className="text-purple-400" />
                                        Deep Fingerprinting & OS Detect
                                    </span>
                                    <div className="flex items-center gap-3 font-mono text-[11px]">
                                        <span className="text-zinc-500">Free: IP & Info Dasar</span>
                                        <span className="text-emerald-400 font-bold">Pro: OS & Port Penuh ✅</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                                    <span className="text-zinc-300 flex items-center gap-2">
                                        <Gauge size={14} className="text-purple-400" />
                                        Bandwidth Speed Throttling (PWM)
                                    </span>
                                    <div className="flex items-center gap-3 font-mono text-[11px]">
                                        <span className="text-zinc-500">Free: ❌</span>
                                        <span className="text-emerald-400 font-bold">Pro: 1% - 99% ✅</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                                    <span className="text-zinc-300 flex items-center gap-2">
                                        <Zap size={14} className="text-purple-400" />
                                        Auto-Reblock Anti Ganti MAC
                                    </span>
                                    <div className="flex items-center gap-3 font-mono text-[11px]">
                                        <span className="text-zinc-500">Free: ❌</span>
                                        <span className="text-emerald-400 font-bold">Pro: Aktif Otomatis ✅</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between py-1">
                                    <span className="text-zinc-300 flex items-center gap-2">
                                        <Radio size={14} className="text-purple-400" />
                                        Smart Transparent Gateway (Sinkhole)
                                    </span>
                                    <div className="flex items-center gap-3 font-mono text-[11px]">
                                        <span className="text-zinc-500">Free: ❌</span>
                                        <span className="text-emerald-400 font-bold">Pro: DNS Filter ✅</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action CTA Buttons */}
                        <div className="flex flex-col gap-2.5">
                            <button
                                type="button"
                                onClick={handleOpenCheckout}
                                className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-500 via-indigo-600 to-purple-600 text-white font-bold text-xs hover:opacity-95 transition-all shadow-xl shadow-purple-500/25 flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <span>Beli Lisensi PRO di Website Portal</span>
                                <ExternalLink size={14} />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    onOpenLoginModal();
                                }}
                                className="w-full py-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white font-medium text-xs border border-white/[0.08] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <Key size={13} />
                                <span>Sudah Punya Kunci / Akun? Masuk di Sini</span>
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
