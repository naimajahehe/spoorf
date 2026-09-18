import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { env, validateEnv } from './config/env';
import { createContainer } from './container';
import { createRouter } from './api/routes';
import { WebSocketManager } from './websocket';
import { corsOriginCallback, hostGuard, apiTokenGuard } from './security';
import { registerGracefulShutdown } from './shutdown';
import { requestLogger } from './middlewares/requestLogger';
import { centralizedErrorHandler } from './middlewares/errorHandler';
import { logger } from './utils/logger';

// Fail-fast environment validation on boot
validateEnv();

const app = express();
const server = createServer(app);

// Middleware
// Request Tracing & Correlation: Injects X-Request-Id and attaches req.log
app.use(requestLogger());

// Security Headers: Helmet hardening with cross-origin resource policy enabled for SPA/Vite
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

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

// Composition Root (Service Container)
const container = createContainer();
const { pythonBridge, databaseService, licenseManager, deviceManager } = container;
new WebSocketManager(server, deviceManager, licenseManager);

// Routes
app.use('/', createRouter(container));

// Centralized Error Handler (Express 4-parameter error middleware)
app.use(centralizedErrorHandler);

// Start
async function start() {
    try {
        logger.info({ module: 'Boot' }, 'Initializing service container...');
        await container.init();

        const PORT = env.PORT;
        const HOST = env.HOST;
        
        server.on('error', (err: any) => {
            logger.error({ module: 'Server', port: PORT, err }, `Server error on port ${PORT}: ${err?.message || err}`);
        });

        server.listen(PORT, HOST, () => {
            logger.info({ module: 'Server', host: HOST, port: PORT }, `Server running on http://${HOST}:${PORT} (localhost only)`);
            logger.info({ module: 'Server' }, `WebSocket: ws://${HOST}:${PORT}`);
            logger.info({ module: 'Database' }, `Database: SQLite (Zero-Config) stored in data/sentinel.db`);
        });

        // Background Python bridge connection and initial scan
        pythonBridge.start().then(async () => {
            logger.info({ module: 'PythonBridge' }, 'Python bridge connected');
            try {
                logger.info({ module: 'Scanner' }, 'Scanning network & synchronizing with SQLite...');
                await deviceManager.scanNetwork();
                logger.info({ module: 'Scanner' }, 'Initial scan & sync complete');
            } catch (err: any) {
                logger.warn({ module: 'Scanner', err }, `Initial scan postponed: ${err?.message || err}`);
            }
        }).catch((err: any) => {
            logger.warn({ module: 'PythonBridge', err }, `Python bridge startup delayed: ${err?.message || err}`);
        });

    } catch (error: any) {
        logger.error({ module: 'Boot', err: error }, `Failed to initialize backend services: ${error?.message || error}`);
    }
}

registerGracefulShutdown({ container, deviceManager, pythonBridge, databaseService, server });
start();
