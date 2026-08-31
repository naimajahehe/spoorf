import { createContext, useContext, ReactNode } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

/**
 * Nilai context = seluruh payload hook useWebSocket (devices, telemetry, aksi, dsb).
 * Memakai ReturnType agar tetap sinkron otomatis dengan hook tanpa menulis ulang
 * ~50 field secara manual.
 */
export type NetworkContextValue = ReturnType<typeof useWebSocket>;

const NetworkContext = createContext<NetworkContextValue | null>(null);

/**
 * Provider tunggal yang memanggil useWebSocket SATU KALI dan menyediakan hasilnya
 * ke seluruh pohon komponen. Ini "seam" agar komponen dapat berhenti menerima
 * data lewat prop-drilling dan langsung memakai useNetwork() secara bertahap.
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
    const value = useWebSocket();
    return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/** Akses state & aksi jaringan dari mana pun di bawah NetworkProvider. */
export function useNetwork(): NetworkContextValue {
    const ctx = useContext(NetworkContext);
    if (!ctx) {
        throw new Error('useNetwork harus dipakai di dalam <NetworkProvider>');
    }
    return ctx;
}
