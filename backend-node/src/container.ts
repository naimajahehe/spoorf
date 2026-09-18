import {
    IServiceContainer,
    IDatabaseService,
    IPythonBridge,
    ILicenseManager,
    ITrafficService,
    IGamingService,
    IDiscoveryService,
    IReconciliationService,
    IDeviceManager
} from './interfaces';
import { DatabaseService } from './services/database';
import { PythonBridge } from './services/pythonBridge';
import { LicenseManager } from './services/licenseManager';
import { DeviceManager } from './services/deviceManager';
import { createChildLogger } from './utils/logger';

export class ServiceContainer implements IServiceContainer {
    private readonly log = createChildLogger('Container');

    public readonly databaseService: IDatabaseService;
    public readonly pythonBridge: IPythonBridge;
    public readonly licenseManager: ILicenseManager;
    public readonly trafficService: ITrafficService;
    public readonly gamingService: IGamingService;
    public readonly discoveryService: IDiscoveryService;
    public readonly reconciliationService: IReconciliationService;
    public readonly deviceManager: IDeviceManager;

    constructor(options: {
        databaseService: IDatabaseService;
        pythonBridge: IPythonBridge;
        licenseManager: ILicenseManager;
        trafficService: ITrafficService;
        gamingService: IGamingService;
        discoveryService: IDiscoveryService;
        reconciliationService: IReconciliationService;
        deviceManager: IDeviceManager;
    }) {
        this.databaseService = options.databaseService;
        this.pythonBridge = options.pythonBridge;
        this.licenseManager = options.licenseManager;
        this.trafficService = options.trafficService;
        this.gamingService = options.gamingService;
        this.discoveryService = options.discoveryService;
        this.reconciliationService = options.reconciliationService;
        this.deviceManager = options.deviceManager;
    }

    async init(): Promise<void> {
        this.log.info('Initializing service container components...');
        await this.databaseService.init();
        await this.licenseManager.init();
        await this.deviceManager.init();
        this.log.info('Service container initialization complete');
    }

    async shutdown(): Promise<void> {
        this.log.info('Shutting down service container components...');
        try {
            if (this.deviceManager && typeof this.deviceManager.shutdown === 'function') {
                this.deviceManager.shutdown();
            }
            if (this.reconciliationService && typeof this.reconciliationService.shutdown === 'function') {
                this.reconciliationService.shutdown();
            }
        } catch (err) {
            this.log.warn({ err }, 'Error during DeviceManager/ReconciliationService shutdown');
        }

        try {
            this.pythonBridge.stop();
        } catch (err) {
            this.log.warn({ err }, 'Error during PythonBridge shutdown');
        }

        try {
            await this.databaseService.close();
        } catch (err) {
            this.log.warn({ err }, 'Error during DatabaseService shutdown');
        }
        this.log.info('Service container shutdown complete');
    }
}

export function createContainer(overrides: Partial<{
    databaseService: IDatabaseService;
    pythonBridge: IPythonBridge;
    licenseManager: ILicenseManager;
    trafficService: ITrafficService;
    gamingService: IGamingService;
    discoveryService: IDiscoveryService;
    reconciliationService: IReconciliationService;
    deviceManager: IDeviceManager;
}> = {}): ServiceContainer {
    const databaseService = overrides.databaseService || new DatabaseService();
    const pythonBridge = overrides.pythonBridge || new PythonBridge();
    const licenseManager = overrides.licenseManager || new LicenseManager(databaseService);
    const deviceManager = overrides.deviceManager || new DeviceManager(
        pythonBridge,
        databaseService,
        licenseManager,
        overrides.trafficService as any,
        overrides.gamingService as any,
        overrides.discoveryService as any,
        overrides.reconciliationService as any
    );
    const trafficService = overrides.trafficService || (deviceManager instanceof DeviceManager ? deviceManager.trafficService : (deviceManager as unknown as ITrafficService));
    const gamingService = overrides.gamingService || (deviceManager instanceof DeviceManager ? deviceManager.gamingService : (deviceManager as unknown as IGamingService));
    const discoveryService = overrides.discoveryService || (deviceManager instanceof DeviceManager ? deviceManager.discoveryService : (deviceManager as unknown as IDiscoveryService));
    const reconciliationService = overrides.reconciliationService || (deviceManager instanceof DeviceManager ? deviceManager.reconciliationService : (deviceManager as unknown as IReconciliationService));

    return new ServiceContainer({
        databaseService,
        pythonBridge,
        licenseManager,
        trafficService,
        gamingService,
        discoveryService,
        reconciliationService,
        deviceManager,
    });
}
