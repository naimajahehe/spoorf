import { Router } from 'express';
import { LicenseManager } from '../services/licenseManager';
import { AuthController } from '../controllers/authController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import { LoginBodySchema, ActivateBodySchema } from '../schemas/authSchemas';

export function registerAuthRoutes(router: Router, licenseManager?: LicenseManager): void {
    const controller = new AuthController(licenseManager);

    router.get('/api/auth/status', safeHandler(controller.getStatus));
    router.get('/api/auth/me', safeHandler(controller.getMe));

    router.post(
        '/api/auth/login',
        validateAndHandle({ body: LoginBodySchema }, controller.login)
    );

    router.post(
        '/api/auth/activate',
        validateAndHandle({ body: ActivateBodySchema }, controller.activate)
    );

    router.post('/api/auth/logout', safeHandler(controller.logout));
}

export function createAuthRouter(licenseManager?: LicenseManager): Router {
    const router = Router();
    registerAuthRoutes(router, licenseManager);
    return router;
}
