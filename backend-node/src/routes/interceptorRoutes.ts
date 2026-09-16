import { Router } from 'express';
import { IDeviceManager, IPythonBridge } from '../interfaces';
import { InterceptorController } from '../controllers/interceptorController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import { LeafCertBodySchema, FlowsQuerySchema } from '../schemas/interceptorSchemas';

export function registerInterceptorRoutes(router: Router, service: IDeviceManager | IPythonBridge): void {
    const controller = new InterceptorController(service);

    router.get('/api/interceptor/ca', safeHandler(controller.getCaInfo));
    router.get('/api/interceptor/ca/download', safeHandler(controller.downloadCaCert));

    router.get(
        '/api/interceptor/flows',
        validateAndHandle({ query: FlowsQuerySchema }, controller.getFlows)
    );

    router.delete('/api/interceptor/flows', safeHandler(controller.clearFlows));

    router.post(
        '/api/interceptor/cert/leaf',
        validateAndHandle({ body: LeafCertBodySchema }, controller.generateLeafCert)
    );
}

export function createInterceptorRouter(service: IDeviceManager | IPythonBridge): Router {
    const router = Router();
    registerInterceptorRoutes(router, service);
    return router;
}
