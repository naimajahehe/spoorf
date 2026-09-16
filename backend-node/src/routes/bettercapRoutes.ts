import { Router } from 'express';
import { DeviceManager } from '../services/deviceManager';
import { LicenseManager } from '../services/licenseManager';
import { BettercapController } from '../controllers/bettercapController';
import { safeHandler } from '../middlewares/errorHandler';
import { validateAndHandle } from '../middlewares/validation';
import {
    AddDnsRuleBodySchema,
    UpdateDnsRuleBodySchema,
    BettercapDnsHostsBodySchema,
    BettercapDnsTtlBodySchema,
    BettercapDnsSpoofAllBodySchema,
    BettercapCredentialsQuerySchema,
    BettercapSynScanBodySchema
} from '../schemas/bettercapSchemas';

export function registerBettercapRoutes(
    router: Router,
    deviceManager: DeviceManager,
    licenseManager?: LicenseManager
): void {
    const controller = new BettercapController(deviceManager, licenseManager);

    router.get('/api/bettercap/status', safeHandler(controller.getStatus));
    router.get('/api/bettercap/dns/rules', safeHandler(controller.getDnsRules));

    router.post(
        '/api/bettercap/dns/rules',
        validateAndHandle({ body: AddDnsRuleBodySchema }, controller.addDnsRule)
    );

    router.put(
        '/api/bettercap/dns/rules/:id',
        validateAndHandle({ body: UpdateDnsRuleBodySchema }, controller.updateDnsRule)
    );

    router.delete('/api/bettercap/dns/rules/:id', safeHandler(controller.deleteDnsRule));

    router.post(
        '/api/bettercap/dns/spoof-all',
        validateAndHandle({ body: BettercapDnsSpoofAllBodySchema }, controller.setDnsSpoofAll)
    );

    router.post(
        '/api/bettercap/dns/hosts',
        validateAndHandle({ body: BettercapDnsHostsBodySchema }, controller.loadDnsHosts)
    );

    router.post(
        '/api/bettercap/dns/ttl',
        validateAndHandle({ body: BettercapDnsTtlBodySchema }, controller.setDnsTtl)
    );

    router.get(
        '/api/bettercap/credentials',
        validateAndHandle({ query: BettercapCredentialsQuerySchema }, controller.getCredentials)
    );

    router.delete('/api/bettercap/credentials', safeHandler(controller.clearCredentials));

    router.post(
        '/api/bettercap/syn-scan',
        validateAndHandle({ body: BettercapSynScanBodySchema }, controller.runSynScan)
    );
}

export function createBettercapRouter(
    deviceManager: DeviceManager,
    licenseManager?: LicenseManager
): Router {
    const router = Router();
    registerBettercapRoutes(router, deviceManager, licenseManager);
    return router;
}
