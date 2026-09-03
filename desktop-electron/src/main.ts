import { app, BrowserWindow, ipcMain, Menu, Tray, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { shouldRespawnAfterExit, buildTreeKillArgs } from './supervisor-logic';

// KEAMANAN (P1): Ephemeral IPC Bearer Token (SPEC-010 §2.4 / §3).
// Di-generate sekali per sesi & disuntik ke env SEBELUM Python di-spawn dan
// backend Node di-require, sehingga kedua proses (mewarisi env) memakai token
// yang sama. Renderer memperolehnya via preload. Mengunci control-plane
// (:5000 & :8001) dari proses lokal lain di mesin yang sama.
const SENTINEL_API_TOKEN = crypto.randomBytes(32).toString('hex');
process.env.SENTINEL_API_TOKEN = SENTINEL_API_TOKEN;

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Supervisor auto-respawn: batasi restart agar tidak crash-loop.
const ENGINE_MAX_RESTARTS = 5;
const ENGINE_RESTART_WINDOW_MS = 60_000;
const ENGINE_RESPAWN_DELAY_MS = 1500;
let engineRestartTimestamps: number[] = [];

// Ensure AppData directory for Spoorf Sentinel
const appDataPath = path.join(app.getPath('appData'), 'SpoorfSentinel');
const logsDir = path.join(appDataPath, 'logs');
const dataDir = path.join(appDataPath, 'data');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const electronLogFile = path.join(logsDir, 'electron.log');
const engineLogFile = path.join(logsDir, 'engine.log');
const logStream = fs.createWriteStream(engineLogFile, { flags: 'a' });

export function logElectron(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        fs.appendFileSync(electronLogFile, line);
    } catch {}
    try {
        process.stdout.write(line);
    } catch {}
}

// Redirect all standard console logs to electron.log
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = (...args: any[]) => {
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    logElectron(`[LOG] ${text}`);
    origLog(...args);
};

console.warn = (...args: any[]) => {
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    logElectron(`[WARN] ${text}`);
    origWarn(...args);
};

console.error = (...args: any[]) => {
    const text = args.map(a => (typeof a === 'object' ? (a?.stack || JSON.stringify(a)) : a)).join(' ');
    logElectron(`[ERROR] ${text}`);
    origError(...args);
};

logElectron('=====================================================');
logElectron(`🚀 Spoorf Sentinel v2.21.0 Launching... (Platform: ${process.platform}, Arch: ${process.arch}, Node: ${process.versions.node}, Electron: ${process.versions.electron})`);
logElectron(`📁 AppPath: ${app.getAppPath()}`);
logElectron(`📁 ResourcesPath: ${process.resourcesPath}`);
logElectron(`📁 AppData: ${appDataPath}`);
logElectron('=====================================================');

// Global Exception & Exit Handlers
process.on('uncaughtException', (err: any) => {
    const errText = err?.stack || err?.message || String(err);
    logElectron(`💥 [FATAL_UNCAUGHT_EXCEPTION] ${errText}`);
    try {
        dialog.showErrorBox('Spoorf Sentinel Startup Error', `Terjadi kendala startup:\n\n${errText}\n\nLog lengkap tersimpan di:\n${electronLogFile}`);
    } catch {}
});

process.on('unhandledRejection', (reason: any) => {
    const errText = reason instanceof Error ? reason.stack : String(reason);
    logElectron(`💥 [UNHANDLED_REJECTION] ${errText}`);
});

process.on('exit', (code) => {
    logElectron(`🛑 [PROCESS_EXIT] Main process exiting with code: ${code}`);
});

app.on('child-process-gone', (e, details) => {
    logElectron(`⚠️ [CHILD_PROCESS_GONE] Subprocess (${details.type}) exited: reason=${details.reason}, code=${details.exitCode}`);
});

app.on('render-process-gone', (e, webContents, details) => {
    logElectron(`⚠️ [RENDER_PROCESS_GONE] Renderer process exited: reason=${details.reason}, code=${details.exitCode}`);
});

// 1. Single Instance Lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    logElectron('[Supervisor] Another instance of Spoorf Sentinel is already running. Quitting.');
    app.quit();
} else {
    logElectron('[Supervisor] Single instance lock acquired successfully.');
    app.on('second-instance', () => {
        logElectron('[Supervisor] Second instance opened. Focusing existing main window.');
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

function getPythonEnginePath(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'engine', 'spoorf-engine.exe');
    }
    const devExe = path.join(__dirname, '../../python-service/dist/spoorf-engine/spoorf-engine.exe');
    if (fs.existsSync(devExe)) {
        return devExe;
    }
    return path.join(__dirname, '../../python-service/venv/Scripts/python.exe');
}

/**
 * Matikan proses engine beserta SELURUH pohon anaknya. Di Windows memakai
 * `taskkill /T /F` agar bootloader PyInstaller / subproses uvicorn tidak lolos
 * menjadi zombie yang menahan port :8001 (penyebab tabrakan bind WinError 10048
 * pada peluncuran berikutnya). Platform lain: fallback ke kill().
 */
function killProcessTree(proc: ChildProcess): void {
    const pid = proc.pid;
    if (pid && process.platform === 'win32') {
        try {
            spawn('taskkill', buildTreeKillArgs(pid), { windowsHide: true, stdio: 'ignore' });
            return;
        } catch (err) {
            logElectron(`[Supervisor] taskkill gagal (${err}); fallback ke kill().`);
        }
    }
    try {
        proc.kill();
    } catch {}
}

function startPythonEngine() {
    try {
        const enginePath = getPythonEnginePath();
        logElectron(`[Supervisor] Spawning Python Engine from: ${enginePath}`);

        if (enginePath.endsWith('.exe')) {
            pythonProcess = spawn(enginePath, [], {
                windowsHide: true,
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });
        } else {
            // Dev fallback with python script
            const scriptPath = path.join(__dirname, '../../python-service/main.py');
            pythonProcess = spawn(enginePath, [scriptPath], {
                windowsHide: true,
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });
        }

        if (pythonProcess.stdout) {
            pythonProcess.stdout.pipe(logStream);
        }
        if (pythonProcess.stderr) {
            pythonProcess.stderr.pipe(logStream);
        }

        // Simpan referensi lokal: exit handler harus tahu proses MANA yang mati,
        // agar restart manual (yang mengganti pythonProcess) tidak memicu respawn ganda.
        const child = pythonProcess;
        child.on('exit', (code, signal) => {
            logElectron(`[Supervisor] Python Engine exited with code ${code}, signal ${signal}`);
            if (pythonProcess === child) {
                pythonProcess = null;
            }
            // Keluar bersih (exit 0) TIDAK di-respawn: itu tanda engine berhenti sengaja,
            // termasuk guard preflight Python yang keluar 0 saat engine lain sudah aktif.
            // Hanya crash (exit != 0) yang layak respawn. Kill sengaja & shutdown app juga skip.
            const respawn = shouldRespawnAfterExit(code, {
                isQuitting,
                intentionalKill: !!(child as any).__intentionalKill
            });
            if (!respawn) {
                if (code === 0 && !isQuitting && !(child as any).__intentionalKill) {
                    logElectron('[Supervisor] Engine keluar bersih (exit 0) — kemungkinan engine lain sudah memegang :8001; tidak me-respawn.');
                }
                return;
            }
            scheduleEngineRespawn(`exit code=${code} signal=${signal}`);
        });
    } catch (err) {
        logElectron(`[Supervisor] Failed to start Python Engine: ${err}`);
        if (!isQuitting) {
            scheduleEngineRespawn(`spawn error: ${err}`);
        }
    }
}

/**
 * Respawn engine dengan guard crash-loop: bila lebih dari ENGINE_MAX_RESTARTS
 * dalam ENGINE_RESTART_WINDOW_MS, berhenti mencoba sampai ada restart manual.
 */
function scheduleEngineRespawn(reason: string) {
    if (isQuitting) return;
    const now = Date.now();
    engineRestartTimestamps = engineRestartTimestamps.filter(t => now - t < ENGINE_RESTART_WINDOW_MS);
    if (engineRestartTimestamps.length >= ENGINE_MAX_RESTARTS) {
        logElectron(`[Supervisor] Python Engine respawn DIHENTIKAN: ${ENGINE_MAX_RESTARTS}x restart dalam ${ENGINE_RESTART_WINDOW_MS / 1000}s (crash loop). Menunggu restart manual.`);
        return;
    }
    engineRestartTimestamps.push(now);
    logElectron(`[Supervisor] Respawn Python Engine dalam ${ENGINE_RESPAWN_DELAY_MS}ms (alasan: ${reason}, percobaan ${engineRestartTimestamps.length}/${ENGINE_MAX_RESTARTS})...`);
    setTimeout(() => {
        if (!isQuitting && !pythonProcess) {
            startPythonEngine();
        }
    }, ENGINE_RESPAWN_DELAY_MS);
}

/**
 * Restart engine yang diminta pengguna (IPC 'engine-restart' dari renderer).
 * Mereset counter crash-loop lalu mematikan proses lama & memulai yang baru.
 */
function restartPythonEngine() {
    if (isQuitting) return;
    logElectron('[Supervisor] Restart engine manual diminta dari UI.');
    engineRestartTimestamps = []; // reset guard crash-loop untuk aksi manual
    if (pythonProcess) {
        const dying = pythonProcess;
        (dying as any).__intentionalKill = true;
        pythonProcess = null;
        killProcessTree(dying);
        // Beri jeda agar port :8001 sempat dilepas sebelum spawn baru.
        setTimeout(() => {
            if (!isQuitting) startPythonEngine();
        }, 800);
    } else {
        startPythonEngine();
    }
}

function startNodeBackend() {
    try {
        logElectron('[Supervisor] Loading embedded Node.js backend directly in Electron Main Process...');
        
        process.env.SENTINEL_DB_PATH = path.join(dataDir, 'sentinel.db');
        process.env.PORT = '5000';
        process.env.HOST = '127.0.0.1';

        const asarBackend = path.join(__dirname, 'backend', 'app.js');
        const unpackedBackend = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'backend', 'app.js');
        const appResourceBackend = path.join(process.resourcesPath, 'app', 'dist', 'backend', 'app.js');
        const devBackend = path.join(__dirname, '../../backend-node/dist/app.js');

        let entryToRun = devBackend;
        if (fs.existsSync(appResourceBackend)) {
            entryToRun = appResourceBackend;
        } else if (fs.existsSync(asarBackend)) {
            entryToRun = asarBackend;
        } else if (fs.existsSync(unpackedBackend)) {
            entryToRun = unpackedBackend;
        }

        logElectron(`[Supervisor] Requiring backend module from: ${entryToRun} (exists: ${fs.existsSync(entryToRun)})`);
        try {
            require(entryToRun);
            logElectron('✅ [Supervisor] Embedded Node.js backend initialized and running on http://127.0.0.1:5000');
        } catch (requireErr: any) {
            const errStack = requireErr?.stack || requireErr?.message || String(requireErr);
            logElectron(`❌ [Supervisor] Fatal error inside require(${entryToRun}): ${errStack}`);
            try {
                dialog.showErrorBox('Spoorf Sentinel Backend Load Error', `Gagal memuat modul backend:\n\n${errStack}\n\nFile log:\n${electronLogFile}`);
            } catch {}
        }
    } catch (err: any) {
        logElectron(`❌ [Supervisor] Error loading embedded Node backend: ${err?.stack || err}`);
    }
}

async function stopAllEnginesGracefully(): Promise<void> {
    return new Promise((resolve) => {
        try {
            // Send un-spoof restore signal to Python
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port: 8001,
                    path: '/api/spoof/stop_all',
                    method: 'POST',
                    timeout: 2000,
                    headers: { 'x-sentinel-token': SENTINEL_API_TOKEN }
                },
                () => {
                    if (pythonProcess) {
                        killProcessTree(pythonProcess);
                    }
                    resolve();
                }
            );

            req.on('error', () => {
                if (pythonProcess) {
                    killProcessTree(pythonProcess);
                }
                resolve();
            });

            req.end();
        } catch {
            if (pythonProcess) {
                killProcessTree(pythonProcess);
            }
            resolve();
        }
    });
}

function createMainWindow() {
    logElectron('[Supervisor] Creating main application window...');
    mainWindow = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 1080,
        minHeight: 720,
        backgroundColor: '#090a0c',
        title: 'Spoorf Sentinel',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Remove default menu bar for clean app feel
    mainWindow.setMenuBarVisibility(false);

    mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
        logElectron(`[UI] Failed to load UI URL: ${url} (Error code: ${code}, ${desc})`);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        logElectron('[UI] UI loaded successfully in renderer process.');
    });

    if (app.isPackaged) {
        const uiIndex = path.join(process.resourcesPath, 'ui', 'index.html');
        logElectron(`[UI] Loading packaged UI from: ${uiIndex}`);
        if (fs.existsSync(uiIndex)) {
            mainWindow.loadFile(uiIndex);
        } else {
            logElectron(`[UI] uiIndex NOT found, falling back to localhost:5000`);
            mainWindow.loadURL('http://127.0.0.1:5000');
        }
    } else {
        // In dev, load local built dist or Vite dev server
        const devDist = path.join(__dirname, '../../frontend-react/dist/index.html');
        if (fs.existsSync(devDist)) {
            mainWindow.loadFile(devDist);
        } else {
            mainWindow.loadURL('http://localhost:5173');
        }
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// IPC Handlers
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

// Restart engine Python dari UI (preload mengekspos electronAPI.restartEngine()).
ipcMain.on('engine-restart', () => {
    restartPythonEngine();
});

// Sediakan token API lokal ke renderer (fallback bila process.env tak terpropagasi).
ipcMain.handle('get-api-token', () => SENTINEL_API_TOKEN);

// App Lifecycle
app.whenReady().then(() => {
    createMainWindow();
    startPythonEngine();
    startNodeBackend();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('before-quit', async (e) => {
    if (!isQuitting) {
        isQuitting = true;
        e.preventDefault();
        logElectron('[Supervisor] Shutting down Spoorf Sentinel and restoring ARP tables...');
        await stopAllEnginesGracefully();
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
