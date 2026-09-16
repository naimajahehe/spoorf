import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { GatewayController } from '../controllers/gatewayController';
import { safeHandler } from '../middlewares/errorHandler';

export function registerGatewayRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new GatewayController(deviceManager);

    router.get('/api/gateway/status', safeHandler(controller.getStatus));
    router.post('/api/gateway/start', safeHandler(controller.startGateway));
    router.post('/api/gateway/stop', safeHandler(controller.stopGateway));
    router.get('/api/gateway/sinkhole', safeHandler(controller.getSinkholeDomains));
    router.post('/api/gateway/sinkhole', safeHandler(controller.addSinkholeDomain));
    router.delete('/api/gateway/sinkhole/:domain', safeHandler(controller.removeSinkholeDomain));
    router.get('/api/gateway/logs', safeHandler(controller.getDnsLogs));
    router.delete('/api/gateway/logs', safeHandler(controller.clearDnsLogs));
}

export function createGatewayRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerGatewayRoutes(router, deviceManager);
    return router;
}
