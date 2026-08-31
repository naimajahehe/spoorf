import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldAlert, Globe, Server, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface DnsSpoofModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (domain: string, target_ip: string, action: 'spoof' | 'sinkhole') => Promise<void>;
    defaultControllerIp?: string;
}

export function DnsSpoofModal({
    isOpen,
    onClose,
    onSubmit,
    defaultControllerIp = '192.168.1.1'
}: DnsSpoofModalProps) {
    const [domain, setDomain] = useState('');
    const [targetIp, setTargetIp] = useState(defaultControllerIp);
    const [action, setAction] = useState<'spoof' | 'sinkhole'>('spoof');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!domain.trim()) {
            setError('Nama domain atau pola wildcard wajib diisi');
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            await onSubmit(domain.trim(), action === 'sinkhole' ? '0.0.0.0' : targetIp.trim(), action);
            setDomain('');
            onClose();
        } catch (err: any) {
            setError(err.message || 'Gagal menyimpan aturan');
        } finally {
            setIsSubmitting(false);
        }
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
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm"
                />

                {/* Modal Window */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative w-full max-w-lg rounded-2xl bg-[#0e1015] border border-white/10 p-6 shadow-2xl z-10 overflow-hidden text-zinc-100"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between pb-4 border-b border-white/10">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                <ShieldAlert size={20} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-white text-base">Tambah Aturan DNS Spoof</h3>
                                <p className="text-xs text-zinc-400">Pola wildcard Bettercap (*.domain.com)</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                        {error && (
                            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                                {error}
                            </div>
                        )}

                        {/* Action selector */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Tindakan Aturan (Action)</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAction('spoof')}
                                    className={cn(
                                        "flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium border transition-all",
                                        action === 'spoof'
                                            ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                                            : "bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white"
                                    )}
                                >
                                    <Server size={14} />
                                    <span>Spoof ke Target IP</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAction('sinkhole')}
                                    className={cn(
                                        "flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium border transition-all",
                                        action === 'sinkhole'
                                            ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                                            : "bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white"
                                    )}
                                >
                                    <Globe size={14} />
                                    <span>Sinkhole (0.0.0.0)</span>
                                </button>
                            </div>
                        </div>

                        {/* Domain Pattern */}
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                                Pola Domain (Mendukung Wildcard)
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={domain}
                                    onChange={(e) => setDomain(e.target.value)}
                                    placeholder="contoh: *.instagram.com, target.corp, *.bank.id"
                                    required
                                    className="w-full bg-[#141720] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 font-mono"
                                />
                            </div>
                            <span className="text-[10px] text-zinc-500 mt-1 block">
                                Gunakan <code>*.domain.com</code> untuk mencegat semua subdomain.
                            </span>
                        </div>

                        {/* Target IP (only if action === 'spoof') */}
                        {action === 'spoof' && (
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs font-medium text-zinc-400">
                                        Alamat IP Tujuan (Spoofed Destination)
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setTargetIp(defaultControllerIp)}
                                        className="text-[10px] text-amber-400 hover:underline"
                                    >
                                        Gunakan IP Ini ({defaultControllerIp})
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    value={targetIp}
                                    onChange={(e) => setTargetIp(e.target.value)}
                                    placeholder="192.168.1.1"
                                    required
                                    className="w-full bg-[#141720] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 font-mono"
                                />
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-white/10">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                            >
                                <Check size={14} />
                                <span>{isSubmitting ? 'Menyimpan...' : 'Terapkan Aturan'}</span>
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
