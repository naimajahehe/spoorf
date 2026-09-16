import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { GamingController } from '../controllers/gamingController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import { GamingToggleBodySchema } from '../schemas/gamingSchemas';

export function registerGamingRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new GamingController(deviceManager);

    router.get('/api/gaming/status', safeHandler(controller.getStatus));

    router.post(
        '/api/gaming/toggle',
        validateAndHandle({ body: GamingToggleBodySchema }, controller.toggle)
    );
}

export function createGamingRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerGamingRoutes(router, deviceManager);
    return router;
}
