import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { GatewayController } from '../controllers/gatewayController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import {
    StartGatewayBodySchema,
    StopGatewayBodySchema,
    SinkholeDomainBodySchema,
    GatewayLogsQuerySchema
} from '../schemas/gatewaySchemas';

export function registerGatewayRoutes(router: Router, deviceManager: DeviceManager): void {
    const controller = new GatewayController(deviceManager);

    router.get('/api/gateway/status', safeHandler(controller.getStatus));

    router.post(
        '/api/gateway/start',
        validateAndHandle({ body: StartGatewayBodySchema }, controller.startGateway)
    );

    router.post(
        '/api/gateway/stop',
        validateAndHandle({ body: StopGatewayBodySchema }, controller.stopGateway)
    );

    router.get('/api/gateway/sinkhole', safeHandler(controller.getSinkholeDomains));

    router.post(
        '/api/gateway/sinkhole',
        validateAndHandle({ body: SinkholeDomainBodySchema }, controller.addSinkholeDomain)
    );

    router.delete('/api/gateway/sinkhole/:domain', safeHandler(controller.removeSinkholeDomain));

    router.get(
        '/api/gateway/logs',
        validateAndHandle({ query: GatewayLogsQuerySchema }, controller.getDnsLogs)
    );

    router.delete('/api/gateway/logs', safeHandler(controller.clearDnsLogs));
}

export function createGatewayRouter(deviceManager: DeviceManager): Router {
    const router = Router();
    registerGatewayRoutes(router, deviceManager);
    return router;
}
