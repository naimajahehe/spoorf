import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck } from 'lucide-react';
import { AuthPage } from './ui/auth-page';
import { NeonMesh } from './ui/neon-mesh';
import { AuthStatusResponse } from '../types';
import { cn } from '../lib/utils';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    authStatus: AuthStatusResponse;
    onLogin: (email: string, password?: string, token?: string, cloudUrl?: string) => Promise<any>;
    onActivateKey: (key: string) => Promise<any>;
    onLogout: () => Promise<any>;
}

export const LoginModal: FC<Props> = ({
    isOpen,
    onClose,
    authStatus,
    onLogin,
    onActivateKey,
    onLogout
}) => {
    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden font-sans">
                {/* Interactive 3D Neon Mesh Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-0 overflow-hidden"
                >
                    <NeonMesh className="w-full h-full" />
                    {/* Semi-transparent dark vignette to focus attention on the center card */}
                    <div
                        onClick={onClose}
                        className="absolute inset-0 bg-black/35 cursor-pointer"
                        title="Klik di luar untuk menutup"
                    />
                </motion.div>

                {/* Modal Container Seamlessly Blended */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.94, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.94, y: 16 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-black/40 backdrop-blur-md border border-white/[0.08] shadow-2xl"
                >
                    {authStatus.isAuthenticated && authStatus.user ? (
                        <div className="relative w-full max-w-md mx-auto bg-[#090a0c] border border-white/[0.12] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
                            {/* Header */}
                            <div className="px-6 py-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <ShieldCheck size={18} className="text-emerald-400 shrink-0" />
                                    <div>
                                        <h3 className="text-sm font-bold text-white tracking-tight">
                                            Spoorfer Cloud Account & Licensing
                                        </h3>
                                        <p className="text-[11px] text-zinc-400 font-mono">
                                            HWID: {authStatus.hwid.substring(0, 12)}...
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="size-8 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 hover:text-rose-300 border border-white/[0.08] text-zinc-400 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                >
                                    <X size={15} />
                                </button>
                            </div>

                            {/* Active Account Status Banner */}
                            <div className="p-5 border-b border-white/[0.06] bg-white/[0.015] flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="size-9 rounded-full bg-white/[0.08] border border-white/[0.12] flex items-center justify-center text-zinc-200 font-bold text-xs">
                                            {authStatus.user.name ? authStatus.user.name.substring(0, 2).toUpperCase() : 'SO'}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold text-white">{authStatus.user.name || authStatus.user.email}</span>
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase",
                                                    authStatus.license.tier === 'vip' ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                                                    authStatus.license.tier === 'pro' ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
                                                    "bg-zinc-800 text-zinc-300 border border-zinc-700"
                                                )}>
                                                    {authStatus.license.tier.toUpperCase()} PLAN
                                                </span>
                                            </div>
                                            <span className="text-[11px] font-mono text-zinc-500">{authStatus.user.email}</span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            await onLogout();
                                            onClose();
                                        }}
                                        className="px-3 py-1 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 transition-colors cursor-pointer"
                                    >
                                        Keluar
                                    </button>
                                </div>

                                <div className="p-2.5 rounded-lg bg-black/30 border border-white/[0.05] text-[11px] text-zinc-400 flex flex-col gap-1">
                                    <div className="flex justify-between">
                                        <span>Batas Target Cut-Off:</span>
                                        <span className="text-white font-mono font-semibold">{authStatus.license.max_cuts >= 999 ? 'Unlimited' : `${authStatus.license.max_cuts} Perangkat`}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Bandwidth Throttling:</span>
                                        <span className={authStatus.license.can_throttle ? "text-emerald-400 font-semibold" : "text-zinc-500"}>
                                            {authStatus.license.can_throttle ? 'Aktif (PWM 1-99%)' : 'Terkunci (Pro)'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <AuthPage
                            authStatus={authStatus}
                            onLogin={onLogin}
                            onActivateKey={onActivateKey}
                            onClose={onClose}
                            isModal={true}
                        />
                    )}
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
