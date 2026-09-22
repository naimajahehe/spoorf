import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PowerOff, LogIn, X } from 'lucide-react';

interface SessionRevokedModalProps {
  isOpen: boolean;
  reason?: string;
  onClose: () => void;
  onReLogin: () => void;
}

export const SessionRevokedModal: React.FC<SessionRevokedModalProps> = ({
  isOpen,
  reason,
  onClose,
  onReLogin,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/75 backdrop-blur-sm cursor-pointer"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 overflow-hidden"
        >
          {/* Subtle Ambient Glow */}
          <div className="absolute -top-16 -right-16 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

          {/* Close Icon */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800/60 transition-colors focus:outline-none cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header & Icon */}
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-950/60 border border-rose-800/50 flex items-center justify-center text-rose-400 mb-4 shadow-lg shadow-rose-950/40">
              <PowerOff className="w-6 h-6 animate-pulse" />
            </div>

            <h3 className="text-base font-bold text-white tracking-tight">
              Sesi Telah Berakhir
            </h3>

            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Akses untuk perangkat ini telah diputuskan dari Web Portal Cloud. Akun Anda telah keluar otomatis.
            </p>

            {reason && (
              <div className="mt-3 w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-800/80 text-[11px] font-mono text-rose-300/90 text-left">
                <span className="text-slate-500 block text-[10px] uppercase font-sans">Keterangan:</span>
                {reason}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onReLogin}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer focus:outline-none"
            >
              <LogIn className="w-4 h-4" />
              <span>Login Kembali</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer focus:outline-none"
            >
              Tutup
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default SessionRevokedModal;
