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
    onCloseRequested: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('request-app-close', handler);
        return () => {
            ipcRenderer.removeListener('request-app-close', handler);
        };
    },
    restartEngine: () => ipcRenderer.send('engine-restart'),
    setTitleBarTheme: (theme: 'dark' | 'light') => ipcRenderer.send('set-titlebar-theme', theme)
});
