import { Router } from 'express';
import { IGamingService, IDeviceManager } from '../interfaces';
import { GamingController } from '../controllers/gamingController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import { GamingToggleBodySchema } from '../schemas/gamingSchemas';

export function registerGamingRoutes(router: Router, gamingService: IGamingService | IDeviceManager): void {
    const controller = new GamingController(gamingService);

    router.get('/api/gaming/status', safeHandler(controller.getStatus));

    router.post(
        '/api/gaming/toggle',
        validateAndHandle({ body: GamingToggleBodySchema }, controller.toggle)
    );
}

export function createGamingRouter(gamingService: IGamingService | IDeviceManager): Router {
    const router = Router();
    registerGamingRoutes(router, gamingService);
    return router;
}
