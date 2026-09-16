import { IServiceContainer, IDatabaseService, IPythonBridge, ILicenseManager, ITrafficService, IGamingService, IDeviceManager } from './interfaces';
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
    public readonly deviceManager: IDeviceManager;

    constructor(options: {
        databaseService: IDatabaseService;
        pythonBridge: IPythonBridge;
        licenseManager: ILicenseManager;
        trafficService: ITrafficService;
        gamingService: IGamingService;
        deviceManager: IDeviceManager;
    }) {
        this.databaseService = options.databaseService;
        this.pythonBridge = options.pythonBridge;
        this.licenseManager = options.licenseManager;
        this.trafficService = options.trafficService;
        this.gamingService = options.gamingService;
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
        overrides.gamingService as any
    );
    const trafficService = overrides.trafficService || (deviceManager instanceof DeviceManager ? deviceManager.trafficService : (deviceManager as unknown as ITrafficService));
    const gamingService = overrides.gamingService || (deviceManager instanceof DeviceManager ? deviceManager.gamingService : (deviceManager as unknown as IGamingService));

    return new ServiceContainer({
        databaseService,
        pythonBridge,
        licenseManager,
        trafficService,
        gamingService,
        deviceManager,
    });
}
