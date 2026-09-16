import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { DeviceController } from '../controllers/deviceController';
import { safeHandler } from '../middlewares/errorHandler';

export function registerDeviceRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new DeviceController(deviceManager);

    router.get('/api/scan', safeHandler(controller.scanNetwork));
    router.get('/api/devices', safeHandler(controller.getDevices));
    router.delete('/api/devices/reset', safeHandler(controller.clearAllDevices));
    router.post('/api/devices/:ip/block', safeHandler(controller.blockDevice));
    router.post('/api/devices/:ip/unblock', safeHandler(controller.unblockDevice));
    router.post('/api/devices/:ip/redirect', safeHandler(controller.redirectDevice));
    router.post('/api/devices/:ip/stop-redirect', safeHandler(controller.stopRedirectDevice));
    router.delete('/api/devices/:mac', safeHandler(controller.deleteDevice));
    router.put('/api/devices/:mac/alias', safeHandler(controller.setDeviceAlias));
    router.post('/api/devices/:ip/limit', safeHandler(controller.setSpeedLimit));
    router.post('/api/devices/:ip/scan-ports', safeHandler(controller.scanDevicePorts));
}

export function createDeviceRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerDeviceRoutes(router, deviceManager);
    return router;
}
