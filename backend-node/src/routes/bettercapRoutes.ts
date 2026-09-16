import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { LicenseManager } from '../services/licenseManager';
import { BettercapController } from '../controllers/bettercapController';
import { safeHandler } from '../middlewares/errorHandler';

export function registerBettercapRoutes(
    router: Router,
    deviceManager: DeviceManager,
    licenseManager?: LicenseManager
): void {
    const controller = new BettercapController(deviceManager, licenseManager);

    router.get('/api/bettercap/status', safeHandler(controller.getStatus));
    router.get('/api/bettercap/dns/rules', safeHandler(controller.getDnsRules));
    router.post('/api/bettercap/dns/rules', safeHandler(controller.addDnsRule));
    router.put('/api/bettercap/dns/rules/:id', safeHandler(controller.updateDnsRule));
    router.delete('/api/bettercap/dns/rules/:id', safeHandler(controller.deleteDnsRule));
    router.post('/api/bettercap/dns/spoof-all', safeHandler(controller.setDnsSpoofAll));
    router.post('/api/bettercap/dns/hosts', safeHandler(controller.loadDnsHosts));
    router.post('/api/bettercap/dns/ttl', safeHandler(controller.setDnsTtl));
    router.get('/api/bettercap/credentials', safeHandler(controller.getCredentials));
    router.delete('/api/bettercap/credentials', safeHandler(controller.clearCredentials));
    router.post('/api/bettercap/syn-scan', safeHandler(controller.runSynScan));
}

export function createBettercapRouter(
    deviceManager: DeviceManager,
    licenseManager?: LicenseManager
): Router {
    const router = Router();
    registerBettercapRoutes(router, deviceManager, licenseManager);
    return router;
}
