import { contextBridge, ipcRenderer } from 'electron';

function getInitialToken(): string {
    if (process.env.SENTINEL_API_TOKEN) {
        return process.env.SENTINEL_API_TOKEN;
    }
    const tokenArg = process.argv.find(arg => arg.startsWith('--sentinel-api-token='));
    if (tokenArg) {
        return tokenArg.split('=')[1] || '';
    }
    try {
        return ipcRenderer.sendSync('get-api-token-sync') || '';
    } catch {
        return '';
    }
}

let cachedIsMinimized = false;
ipcRenderer.on('window-minimize-state', (_event, isMin) => {
    cachedIsMinimized = Boolean(isMin);
});

contextBridge.exposeInMainWorld('electronAPI', {
    isDesktop: true,
    appVersion: '2.35.0',
    // KEAMANAN (P1): Token bearer lokal untuk memanggil control-plane (:5000/:8001).
    apiToken: getInitialToken(),
    getApiToken: () => ipcRenderer.invoke('get-api-token'),
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    confirmClose: () => ipcRenderer.send('confirm-app-close'),
    focusWindow: () => ipcRenderer.send('window-focus'),
    // Baca status dari cache yang disegarkan event async 'window-minimize-state' (dipancarkan
    // main saat minimize/restore/show/hide). Hindari ipcRenderer.sendSync yang MEMBLOKIR thread
    // renderer pada SETIAP notifikasi → mencegah jank saat notifikasi datang beruntun.
    isWindowMinimized: () => cachedIsMinimized,
    onCloseRequested: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('request-app-close', handler);
        return () => {
            ipcRenderer.removeListener('request-app-close', handler);
        };
    },
    restartEngine: () => ipcRenderer.send('engine-restart'),
    setTitleBarTheme: (theme: 'dark' | 'light') => ipcRenderer.send('set-titlebar-theme', theme),
    showInteractiveNotification: (options: any) => ipcRenderer.send('show-interactive-notification', options),
    onNotificationAction: (callback: (data: any) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('notification-action', handler);
        return () => {
            ipcRenderer.removeListener('notification-action', handler);
        };
    }
});
