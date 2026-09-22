import React, { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PowerOff, LogIn, X } from 'lucide-react';

interface SessionRevokedModalProps {
  isOpen: boolean;
  reason?: string;
  onClose: () => void;
  onProceedToLogin?: () => void;
}

export const SessionRevokedModal: React.FC<SessionRevokedModalProps> = ({
  isOpen,
  reason,
  onClose,
  onProceedToLogin,
}) => {
  const handleProceed = useCallback(() => {
    if (onProceedToLogin) {
      onProceedToLogin();
    } else {
      onClose();
    }
  }, [onProceedToLogin, onClose]);

  // Global Escape key listener to close modal and proceed to login
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleProceed();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleProceed]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-revoked-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans select-none"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleProceed}
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
              onClick={handleProceed}
              aria-label="Tutup dan kembali ke halaman login"
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header & Icon */}
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-rose-950/60 border border-rose-800/50 flex items-center justify-center text-rose-400 mb-4 shadow-lg shadow-rose-950/40">
                <PowerOff className="w-6 h-6 animate-pulse" />
              </div>

              <h3 id="session-revoked-title" className="text-base font-bold text-white tracking-tight">
                Sesi Telah Berakhir
              </h3>

              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Akses untuk perangkat ini telah diputuskan dari Web Portal Cloud. Anda akan dialihkan kembali ke halaman login.
              </p>

              {reason && (
                <div className="mt-3 w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-800/80 text-[11px] font-mono text-rose-300/90 text-left">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans">Keterangan:</span>
                  {reason}
                </div>
              )}
            </div>

            {/* Single Action Button */}
            <div className="mt-6">
              <button
                type="button"
                autoFocus
                onClick={handleProceed}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              >
                <LogIn className="w-4 h-4" />
                <span>Kembali ke Halaman Login</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SessionRevokedModal;
