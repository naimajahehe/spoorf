import { Router } from 'express';
import { IDeviceManager } from '../interfaces';
import { NetworkController } from '../controllers/networkController';
import { safeHandler } from '../middlewares/errorHandler';

export function registerNetworkRoutes(router: Router, deviceManager: IDeviceManager): void {
    const controller = new NetworkController(deviceManager);

    router.get('/api/telemetry', safeHandler(controller.getTelemetry));
    router.get('/api/wifi', safeHandler(controller.getWifi));
    router.post('/api/network/optimize-dhcp', safeHandler(controller.optimizeDhcp));
    router.post('/api/network/profile-refresh', safeHandler(controller.profileRefresh));
    router.post('/api/network/quick-reauth', safeHandler(controller.quickReauth));
    router.get('/api/dhcp/stats', safeHandler(controller.getDhcpStats));
    router.get('/api/network/ap-isolation', safeHandler(controller.getApIsolationStatus));
}

export function createNetworkRouter(deviceManager: IDeviceManager): Router {
    const router = Router();
    registerNetworkRoutes(router, deviceManager);
    return router;
}
