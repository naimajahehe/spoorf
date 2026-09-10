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
        confirmClose?: () => void;
        onCloseRequested?: (callback: () => void) => () => void;
        focusWindow?: () => void;
        isWindowMinimized?: () => boolean;
        restartEngine?: () => void;
        setTitleBarTheme?: (theme: 'dark' | 'light') => void;
        showInteractiveNotification?: (options: {
            title: string;
            body: string;
            ip?: string;
            mac?: string;
            is_gateway?: boolean;
            is_self?: boolean;
            toastType?: 'new_device' | 'reconnected';
        }) => void;
        onNotificationAction?: (callback: (data: { action: 'block' | 'inspect'; ip?: string; mac?: string }) => void) => () => void;
    }

    interface Window {
        electronAPI?: ElectronAPI;
    }
}
