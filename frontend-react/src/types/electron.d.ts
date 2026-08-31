/**
 * Tipe untuk API yang diekspos preload Electron ke renderer (window.electronAPI).
 * Di lingkungan browser (dev Vite), `window.electronAPI` bernilai undefined.
 */
export {};

declare global {
    interface ElectronAPI {
        isDesktop?: boolean;
        appVersion?: string;
        /** Token bearer lokal (P1) untuk memanggil control-plane :5000 / :8001. */
        apiToken?: string;
        minimizeWindow?: () => void;
        maximizeWindow?: () => void;
        closeWindow?: () => void;
        restartEngine?: () => void;
    }

    interface Window {
        electronAPI?: ElectronAPI;
    }
}
