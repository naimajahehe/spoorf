import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { ShieldController } from '../controllers/shieldController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import { ShieldToggleBodySchema, ShieldModeBodySchema } from '../schemas/shieldSchemas';

export function registerShieldRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new ShieldController(deviceManager);

    router.get('/api/shield/status', safeHandler(controller.getStatus));

    router.post(
        '/api/shield/toggle',
        validateAndHandle({ body: ShieldToggleBodySchema }, controller.toggle)
    );

    router.post(
        '/api/shield/mode',
        validateAndHandle({ body: ShieldModeBodySchema }, controller.setMode)
    );

    router.get('/api/shield/threats', safeHandler(controller.getThreats));
    router.delete('/api/shield/threats', safeHandler(controller.clearThreats));
}

export function createShieldRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerShieldRoutes(router, deviceManager);
    return router;
}
