import { Router } from 'express';
import { IDeviceManager, ILicenseManager, IServiceContainer } from '../interfaces';
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
    containerOrDeviceManager: IServiceContainer | IDeviceManager,
    licenseManager?: ILicenseManager
): Router {
    const router = Router();

    let deviceManager: IDeviceManager;
    let licManager: ILicenseManager | undefined = licenseManager;

    if (containerOrDeviceManager && 'deviceManager' in containerOrDeviceManager && 'databaseService' in containerOrDeviceManager) {
        const container = containerOrDeviceManager as IServiceContainer;
        deviceManager = container.deviceManager;
        licManager = licManager || container.licenseManager;
    } else {
        deviceManager = containerOrDeviceManager as IDeviceManager;
    }

    registerSystemRoutes(router, deviceManager);
    registerDeviceRoutes(router, deviceManager);
    registerNetworkRoutes(router, deviceManager);
    registerGatewayRoutes(router, deviceManager);
    registerInterceptorRoutes(router, deviceManager);
    registerBettercapRoutes(router, deviceManager, licManager);
    registerAuthRoutes(router, licManager);
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
