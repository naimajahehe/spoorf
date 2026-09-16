import { Router } from 'express';
import { IDeviceManager } from '../interfaces';
import { SystemController } from '../controllers/systemController';
import { safeHandler } from '../middlewares/errorHandler';

export function registerSystemRoutes(router: Router, deviceManager: IDeviceManager): void {
    const controller = new SystemController(deviceManager);

    router.get(['/health', '/api/health'], safeHandler(controller.getHealth));
    router.get('/api/system/diagnostics', safeHandler(controller.getDiagnostics));
    router.get('/api/status', safeHandler(controller.getStatus));
    router.get('/api/gateway', safeHandler(controller.getGateway));
}

export function createSystemRouter(deviceManager: IDeviceManager): Router {
    const router = Router();
    registerSystemRoutes(router, deviceManager);
    return router;
}
