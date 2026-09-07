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
    restartEngine: () => ipcRenderer.send('engine-restart')
});
