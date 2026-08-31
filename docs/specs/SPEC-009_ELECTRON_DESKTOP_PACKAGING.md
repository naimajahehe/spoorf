# SPEC-009: Electron Desktop Packaging & Distribution Pipeline

> **Document Status:** Authoritative Architectural Specification  
> **Target Version:** Spoorf Sentinel Desktop v2.21.0+  
> **Packaging Stack:** Electron + Node.js (Embedded) + React 18 (Vite) + Python Engine (Sidecar Executable)  
> **Target Operating System:** Windows 10/11 (x64) with Npcap Driver

---

## 1. Architectural Overview

NetCut Sentinel (Spoorf) dikemas menjadi **Single Windows Application (`.exe` / `.msi`)** menggunakan ekosistem **Electron Builder**. Seluruh microservice internal berjalan di dalam satu paket mandiri tanpa memerlukan instalasi manual Node.js, Python, atau database eksternal oleh pengguna awam.

```
+───────────────────────────────────────────────────────────────────────────────────────────+
|               ELECTRON CONTAINER APPLICATION (SPOORF SENTINEL DESKTOP .EXE)               |
+───────────────────────────────────────────────────────────────────────────────────────────+
|                                                                                           |
|  [ Electron Main Process (electron/main.ts) ]                                            |
|   ├── Window Management (Frameless Glassmorphism Window, Min/Max/Close Controls)         |
|   ├── Single Instance Lock (Mencegah multiple instances berjalan bersamaan)              |
|   ├── System Tray Icon & Background Minimization                                          |
|   ├── UAC Administrator Elevation (`requireAdministrator`)                               |
|   └── Process Supervisor & Lifecycle Manager:                                             |
|        ├── Spawns & Monitors Node.js Embedded Orchestrator (:5000)                        |
|        └── Spawns & Monitors Python Engine Executable Sidecar (:8001)                     |
|                                                                                           |
|  [ Electron Renderer Process (frontend-react/dist) ]                                      |
|   ├── React 18 SPA (BeUI Motion + Tailwind + Framer Motion)                               |
|   └── Socket.IO Client connected to Internal Loopback (`127.0.0.1:5000`)                 |
|                                                                                           |
|  [ Embedded Node.js Orchestrator (backend-node) ]                                         |
|   ├── Express 4 API + Socket.IO Server                                                    |
|   ├── SQLite 3 Embedded Database (`resources/data/sentinel.db`)                           |
|   └── LicenseManager (HWID Binding & Feature Gates)                                       |
|                                                                                           |
|  [ Bundled Python Network Engine (resources/bin/spoorf-engine.exe) ]                      |
|   ├── Standalone Executable compiled via PyInstaller                                     |
|   ├── Scapy + Npcap Layer 2 Raw Ethernet Frame Injection                                  |
|   └── Fast Uvicorn Server (:8001) bound strictly to `127.0.0.1`                           |
|                                                                                           |
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Directory Structure of Electron Wrapper

```text
d:/spoorf/
├── desktop-electron/          # Electron Master Wrapper (New Module)
│   ├── src/
│   │   ├── main.ts            # Electron Main Process (Supervisor, Tray, IPC)
│   │   ├── preload.ts         # Secure Context Bridge (Window control API)
│   │   ├── supervisor.ts      # Child process spawner for Node & Python sidecar
│   │   └── npcapCheck.ts      # Npcap driver detection & silent installer helper
│   ├── build/                 # App icons (.ico, .png) and NSIS installer scripts
│   ├── package.json           # Electron build dependencies & electron-builder config
│   └── tsconfig.json          # TypeScript config for Electron Main Process
├── python-service/            # Python microservice (built to spoorf-engine.exe)
├── backend-node/              # Node.js backend orchestrator
└── frontend-react/            # React 18 frontend dashboard
```

---

## 3. Child Process Lifecycle & Supervisor

### 3.1. Startup Sequence:
1. **UAC Elevation Check**: Electron meminta izin Administrator saat pertama kali dibuka untuk akses Npcap raw packet injection.
2. **Npcap Prerequisite Check**:
   - Memeriksa keberadaan `C:\Windows\System32\Npcap\wpcap.dll`.
   - Jika belum terpasang, Electron menampilkan prompt one-click untuk menginstal Npcap OEM driver secara otomatis.
3. **Spawn Python Sidecar (`spoorf-engine.exe`)**:
   - Dieksekusi pada `127.0.0.1:8001` dengan flag *hidden console window* (`CREATE_NO_WINDOW`).
4. **Spawn Node.js Backend**:
   - Menginisialisasi SQLite database di `%APPDATA%/SpoorfSentinel/data/sentinel.db`.
   - Menghubungkan WebSocket ke Python Engine.
5. **Load UI in Chromium Window**:
   - Membuka React build dari `frontend-react/dist/index.html`.

### 3.2. Graceful Shutdown & Zombie Cleanup:
Saat pengguna menutup aplikasi atau sistem shutdown:
- Electron Main Process mengirim sinyal `SIGTERM` / `stopAll()` ke Python Engine untuk **memulihkan seluruh ARP table (Un-spoofing otomatis)** agar jaringan LAN tidak terputus.
- Menutup koneksi database SQLite dengan aman.
- Mematikan seluruh child process sebelum memanggil `app.quit()`.

---

## 4. Electron Builder Packaging Configuration

Pada `desktop-electron/package.json`:
```json
{
  "name": "spoorf-sentinel",
  "version": "2.21.0",
  "description": "Next-Gen Layer 2 Network Discovery & Control Suite",
  "main": "dist/main.js",
  "build": {
    "appId": "com.spoorf.sentinel",
    "productName": "Spoorf Sentinel",
    "win": {
      "target": ["nsis", "portable"],
      "icon": "build/icon.ico",
      "requestedExecutionLevel": "requireAdministrator"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Spoorf Sentinel"
    },
    "extraResources": [
      {
        "from": "../python-service/dist/spoorf-engine.exe",
        "to": "engine/spoorf-engine.exe"
      },
      {
        "from": "../backend-node/dist",
        "to": "backend"
      },
      {
        "from": "build/npcap-installer.exe",
        "to": "prerequisites/npcap-installer.exe"
      }
    ]
  }
}
```

---

## 5. Keunggulan Solusi Electron yang Dipilih

1. **Zero Logic Rewrite**:
   - 100% kode Node.js (`DeviceManager`, `LicenseManager`, SQLite) dan React UI yang sudah ada digunakan secara langsung tanpa perlu konversi ke bahasa lain.
2. **Kestabilan Npcap & Python**:
   - Python tetap berjalan sebagai proses native terisolasi dengan akses penuh ke Scapy dan driver Npcap Windows.
3. **Pengalaman Pengguna Ramah (Seamless UX)**:
   - Pengguna cukup mendownload 1 file `SpoorfSentinel-Setup.exe`.
   - Icon desktop otomatis dibuat, window modern frameless dengan glassmorphism UI.
