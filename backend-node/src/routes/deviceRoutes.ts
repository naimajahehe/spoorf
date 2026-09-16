import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { DeviceController } from '../controllers/deviceController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import {
    BlockDeviceParamsSchema,
    BlockDeviceBodySchema,
    UnblockDeviceParamsSchema,
    RedirectDeviceParamsSchema,
    RedirectDeviceBodySchema,
    DeleteDeviceParamsSchema,
    SetAliasParamsSchema,
    SetAliasBodySchema,
    SpeedLimitParamsSchema,
    SpeedLimitBodySchema,
    ScanDevicePortsBodySchema
} from '../schemas/deviceSchemas';

export function registerDeviceRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new DeviceController(deviceManager);

    router.get('/api/scan', safeHandler(controller.scanNetwork));
    router.get('/api/devices', safeHandler(controller.getDevices));
    router.delete('/api/devices/reset', safeHandler(controller.clearAllDevices));

    router.post(
        '/api/devices/:ip/block',
        validateAndHandle({ params: BlockDeviceParamsSchema, body: BlockDeviceBodySchema }, controller.blockDevice)
    );

    router.post(
        '/api/devices/:ip/unblock',
        validateAndHandle({ params: UnblockDeviceParamsSchema }, controller.unblockDevice)
    );

    router.post(
        '/api/devices/:ip/redirect',
        validateAndHandle({ params: RedirectDeviceParamsSchema, body: RedirectDeviceBodySchema }, controller.redirectDevice)
    );

    router.post(
        '/api/devices/:ip/stop-redirect',
        validateAndHandle({ params: UnblockDeviceParamsSchema }, controller.stopRedirectDevice)
    );

    router.delete(
        '/api/devices/:mac',
        validateAndHandle({ params: DeleteDeviceParamsSchema }, controller.deleteDevice)
    );

    router.put(
        '/api/devices/:mac/alias',
        validateAndHandle({ params: SetAliasParamsSchema, body: SetAliasBodySchema }, controller.setDeviceAlias)
    );

    router.post(
        '/api/devices/:ip/limit',
        validateAndHandle({ params: SpeedLimitParamsSchema, body: SpeedLimitBodySchema }, controller.setSpeedLimit)
    );

    router.post(
        '/api/devices/:ip/scan-ports',
        validateAndHandle({ body: ScanDevicePortsBodySchema }, controller.scanDevicePorts)
    );
}

export function createDeviceRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerDeviceRoutes(router, deviceManager);
    return router;
}
