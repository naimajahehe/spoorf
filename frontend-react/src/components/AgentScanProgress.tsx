import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SCAN_PHRASES = [
    'Checking kernel ARP table...',
    'Broadcasting mDNS & SSDP wakeup burst...',
    'Transmitting Layer 2 ARP requests...',
    'Probing active TCP sockets (254 IPs)...',
    'Parallel NetBIOS & OS enrichment...',
    'Synthesizing network topology...'
];

export const AgentScanProgress: FC = () => {
    const [phraseIndex, setPhraseIndex] = useState(0);
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setSeconds(prev => +(prev + 0.1).toFixed(1));
        }, 100);

        const phraseInterval = setInterval(() => {
            setPhraseIndex(prev => (prev + 1) % SCAN_PHRASES.length);
        }, 700);

        return () => {
            clearInterval(interval);
            clearInterval(phraseInterval);
        };
    }, []);

    return (
        <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-zinc-300 select-none">
            <motion.svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.85, ease: 'linear', repeat: Infinity }}
                className="shrink-0 text-zinc-400"
            >
                <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.25}
                    strokeWidth="3"
                />
                <path
                    d="M 12 3 A 9 9 0 0 1 21 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
            </motion.svg>

            <div className="overflow-hidden h-4 flex items-center min-w-[160px] max-w-[240px]">
                <AnimatePresence mode="wait">
                    <motion.span
                        key={phraseIndex}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                        className="truncate text-[11px] text-zinc-300"
                    >
                        {SCAN_PHRASES[phraseIndex]}
                    </motion.span>
                </AnimatePresence>
            </div>

            <span className="text-[11px] font-mono text-zinc-500">{seconds}s</span>
        </div>
    );
};
