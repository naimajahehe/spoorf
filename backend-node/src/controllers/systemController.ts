import { Request, Response } from 'express';
import { DeviceManager } from '../services/deviceManager';

export class SystemController {
    constructor(private readonly deviceManager: DeviceManager) {}

    getHealth = (_req: Request, res: Response): void => {
        const memoryFallback = this.deviceManager.isUsingMemoryFallback();
        const pythonReady = this.deviceManager.isPythonReady();
        res.json({
            status: pythonReady ? 'ok' : 'degraded',
            services: {
                backend: true,
                database: true,
                database_persistent: !memoryFallback,
                python_engine: pythonReady
            },
            warnings: [
                ...(memoryFallback ? ['Database berjalan in-memory: data perangkat & lisensi tidak tersimpan permanen.'] : []),
                ...(!pythonReady ? ['Python FastAPI Engine (:8001) belum terhubung atau sedang booting.'] : [])
            ],
            timestamp: new Date().toISOString()
        });
    };

    getDiagnostics = async (_req: Request, res: Response): Promise<void> => {
        const diag = await this.deviceManager.getSystemDiagnostics();
        res.json(diag);
    };

    getStatus = async (_req: Request, res: Response): Promise<void> => {
        const status = await this.deviceManager.getStatus();
        res.json({
            success: true,
            status
        });
    };

    getGateway = (_req: Request, res: Response): void => {
        const gateway = this.deviceManager.findGateway();
        res.json({
            success: true,
            gateway: gateway || null
        });
    };
}
