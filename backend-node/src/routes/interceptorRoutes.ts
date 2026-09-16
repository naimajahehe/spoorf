import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { InterceptorController } from '../controllers/interceptorController';
import { safeHandler } from '../middlewares/errorHandler';

export function registerInterceptorRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new InterceptorController(deviceManager);

    router.get('/api/interceptor/ca', safeHandler(controller.getCaInfo));
    router.get('/api/interceptor/ca/download', safeHandler(controller.downloadCaCert));
    router.get('/api/interceptor/flows', safeHandler(controller.getFlows));
    router.delete('/api/interceptor/flows', safeHandler(controller.clearFlows));
    router.post('/api/interceptor/cert/leaf', safeHandler(controller.generateLeafCert));
}

export function createInterceptorRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerInterceptorRoutes(router, deviceManager);
    return router;
}
