import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    isDesktop: true,
    appVersion: '2.21.0',
    // KEAMANAN (P1): Token bearer lokal untuk memanggil control-plane (:5000/:8001).
    // Preload berjalan di konteks Node & mewarisi env proses utama Electron.
    apiToken: process.env.SENTINEL_API_TOKEN || '',
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    restartEngine: () => ipcRenderer.send('engine-restart')
});
