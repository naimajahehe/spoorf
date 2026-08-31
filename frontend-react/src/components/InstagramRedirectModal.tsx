import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldAlert, ExternalLink, ArrowRight, Radio } from 'lucide-react';
import { InstagramIcon } from './icons/InstagramIcon';
import { Device } from '../types';

interface Props {
    device: Device | null;
    isOpen: boolean;
    onClose: () => void;
    onStartRedirect: (ip: string, redirectUrl: string, username: string) => Promise<void>;
    onStopRedirect: (ip: string) => Promise<void>;
}

export const InstagramRedirectModal: React.FC<Props> = ({
    device,
    isOpen,
    onClose,
    onStartRedirect,
    onStopRedirect
}) => {
    const [inputVal, setInputVal] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Muat default tersimpan dari localStorage
    useEffect(() => {
        if (isOpen && device) {
            setError(null);
            if (device.redirect_url) {
                setInputVal(device.redirect_url);
            } else {
                try {
                    const saved = localStorage.getItem('sentinel_default_instagram') || '';
                    setInputVal(saved);
                } catch {
                    setInputVal('');
                }
            }
        }
    }, [isOpen, device]);

    if (!isOpen || !device) return null;

    // Format input menjadi username bersih dan URL lengkap
    const cleanUsername = inputVal.trim()
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/^@/, '')
        .split('/')[0]
        .split('?')[0];

    const fullUrl = cleanUsername
        ? `https://www.instagram.com/${cleanUsername}/`
        : '';

    const handleStart = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!cleanUsername) {
            setError('Silakan masukkan username atau tautan Instagram yang valid.');
            return;
        }

        try {
            setLoading(true);
            setError(null);
            try {
                localStorage.setItem('sentinel_default_instagram', cleanUsername);
            } catch {}

            await onStartRedirect(device.ip, fullUrl, cleanUsername);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Gagal memulai redirect.');
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        try {
            setLoading(true);
            setError(null);
            await onStopRedirect(device.ip);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Gagal menghentikan redirect.');
        } finally {
            setLoading(false);
        }
    };

    const displayName = device.alias || device.hostname || device.ip;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/75 backdrop-blur-sm"
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="relative w-full max-w-md rounded-2xl bg-[#0e1015] border border-white/[0.08] p-6 shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <div className="size-10 rounded-xl bg-gradient-to-tr from-purple-500/20 via-pink-500/20 to-orange-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400">
                                <InstagramIcon size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-white tracking-tight">
                                    {device.is_redirected ? 'Pengaturan Redirect Instagram' : 'Alihkan ke Instagram'}
                                </h3>
                                <p className="text-xs text-zinc-400">
                                    Target: <span className="font-mono text-zinc-200">{displayName}</span> ({device.ip})
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="size-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Info Card: Walled Garden Explainer */}
                    <div className="mb-5 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3.5 text-xs text-zinc-400 flex gap-2.5">
                        <Radio size={16} className="text-pink-400 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-medium text-zinc-200">Walled Garden Portal:</span> Semua permintaan web korban akan dibelokkan ke profil Instagram Anda melalui DNS Spoofing (UDP 53) dan Captive Portal (Port 80).
                        </div>
                    </div>

                    {error && (
                        <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-300 flex items-center gap-2">
                            <ShieldAlert size={15} className="shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Form Input */}
                    <form onSubmit={handleStart}>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                                    Username atau Link Akun Instagram
                                </label>
                                <div className="relative">
                                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500 text-xs">
                                        @
                                    </span>
                                    <input
                                        type="text"
                                        value={inputVal}
                                        onChange={(e) => setInputVal(e.target.value)}
                                        placeholder="username_anda"
                                        disabled={loading || device.is_redirected}
                                        className="w-full pl-7 pr-3 py-2 bg-black/40 border border-white/[0.1] rounded-xl text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-pink-500/50 transition-colors"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {fullUrl && (
                                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/30 border border-white/[0.04] text-[11px] text-zinc-400">
                                    <span className="truncate">URL: <span className="font-mono text-zinc-300">{fullUrl}</span></span>
                                    <a
                                        href={fullUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-pink-400 hover:text-pink-300 ml-2 shrink-0 inline-flex items-center gap-1"
                                    >
                                        Uji <ExternalLink size={11} />
                                    </a>
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-6 flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                            >
                                Batal
                            </button>

                            {device.is_redirected ? (
                                <button
                                    type="button"
                                    onClick={handleStop}
                                    disabled={loading}
                                    className="px-4 py-2 rounded-xl text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-colors"
                                >
                                    {loading ? 'Menghentikan...' : 'Hentikan Redirect'}
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={loading || !cleanUsername}
                                    className="px-4 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-lg shadow-pink-500/20 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all inline-flex items-center gap-1.5"
                                >
                                    <span>{loading ? 'Memproses...' : 'Mulai Redirect'}</span>
                                    <ArrowRight size={13} />
                                </button>
                            )}
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
