import { Request, Response } from 'express';
import { IDeviceManager } from '../interfaces';

export class SystemController {
    constructor(private readonly deviceManager: IDeviceManager) {}

    getHealth = (_req: Request, res: Response): void => {
        const memoryFallback = typeof this.deviceManager.isUsingMemoryFallback === 'function'
            ? this.deviceManager.isUsingMemoryFallback()
            : false;
        const pythonReady = typeof this.deviceManager.isPythonReady === 'function'
            ? this.deviceManager.isPythonReady()
            : true;
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
        const diag = typeof this.deviceManager.getSystemDiagnostics === 'function'
            ? await this.deviceManager.getSystemDiagnostics()
            : {};
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
