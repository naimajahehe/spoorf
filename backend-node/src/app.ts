import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { PythonBridge } from './services/pythonBridge';
import { DatabaseService } from './services/database';
import { LicenseManager } from './services/licenseManager';
import { DeviceManager } from './services/deviceManager';
import { createRouter } from './api/routes';
import { WebSocketManager } from './websocket';
import { corsOriginCallback, hostGuard, apiTokenGuard } from './security';
import { registerGracefulShutdown } from './shutdown';

dotenv.config();

const app = express();
const server = createServer(app);

// Middleware
// CORS: allowlist ketat (localhost / 127.0.0.1 / file:// + ALLOWED_ORIGINS).
// Origin tak dikenal ditolak — mencegah drive-by fetch dari situs jahat di browser.
app.use(cors({
    origin: corsOriginCallback,
    credentials: true
}));
// Proteksi DNS-rebinding: tolak request yang header Host-nya bukan loopback backend.
app.use(hostGuard);
// Auth token bearer lokal (opsional) — aktif bila SENTINEL_API_TOKEN diset (Electron).
app.use(apiTokenGuard);
app.use(express.json());

// Services
const pythonBridge = new PythonBridge();
const databaseService = new DatabaseService();
const licenseManager = new LicenseManager(databaseService);
const deviceManager = new DeviceManager(pythonBridge, databaseService, licenseManager);
const wsManager = new WebSocketManager(server, deviceManager, licenseManager);

// Routes
app.use('/', createRouter(deviceManager, licenseManager));

// Start
async function start() {
    try {
        console.log('🗄️ Initializing SQLite database...');
        await databaseService.init();
        await licenseManager.init();
        await deviceManager.init();

        const PORT = parseInt(process.env.PORT || '5000', 10);
        const HOST = process.env.HOST || '127.0.0.1';
        
        server.on('error', (err: any) => {
            console.error('❌ [Backend] Server error on port 5000:', err?.message || err);
        });

        server.listen(PORT, HOST, () => {
            console.log(`✅ Server running on http://${HOST}:${PORT} (localhost only)`);
            console.log(`   WebSocket: ws://${HOST}:${PORT}`);
            console.log(`   Database: SQLite (Zero-Config) stored in data/sentinel.db`);
        });

        // Background Python bridge connection and initial scan
        pythonBridge.start().then(async () => {
            console.log('✅ Python bridge connected');
            try {
                console.log('🔍 Scanning network & synchronizing with SQLite...');
                await deviceManager.scanNetwork();
                console.log('✅ Initial scan & sync complete');
            } catch (err) {
                console.warn('⚠️ Initial scan postponed:', err);
            }
        }).catch(err => {
            console.warn('⚠️ Python bridge startup delayed:', err);
        });

    } catch (error) {
        console.error('❌ [Backend] Failed to initialize backend services:', error);
    }
}

registerGracefulShutdown({ pythonBridge, databaseService, server });
start();
