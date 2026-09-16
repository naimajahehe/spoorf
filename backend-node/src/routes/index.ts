import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { LicenseManager } from '../services/licenseManager';
import { registerSystemRoutes } from './systemRoutes';
import { registerDeviceRoutes } from './deviceRoutes';
import { registerNetworkRoutes } from './networkRoutes';
import { registerGatewayRoutes } from './gatewayRoutes';
import { registerInterceptorRoutes } from './interceptorRoutes';
import { registerBettercapRoutes } from './bettercapRoutes';
import { registerAuthRoutes } from './authRoutes';
import { registerShieldRoutes } from './shieldRoutes';
import { registerGamingRoutes } from './gamingRoutes';

export function createRouter(
    deviceManager: DeviceManager,
    licenseManager?: LicenseManager
): Router {
    const router = Router();

    registerSystemRoutes(router, deviceManager);
    registerDeviceRoutes(router, deviceManager);
    registerNetworkRoutes(router, deviceManager);
    registerGatewayRoutes(router, deviceManager);
    registerInterceptorRoutes(router, deviceManager);
    registerBettercapRoutes(router, deviceManager, licenseManager);
    registerAuthRoutes(router, licenseManager);
    registerShieldRoutes(router, deviceManager);
    registerGamingRoutes(router, deviceManager);

    return router;
}

export * from './systemRoutes';
export * from './deviceRoutes';
export * from './networkRoutes';
export * from './gatewayRoutes';
export * from './interceptorRoutes';
export * from './bettercapRoutes';
export * from './authRoutes';
export * from './shieldRoutes';
export * from './gamingRoutes';
