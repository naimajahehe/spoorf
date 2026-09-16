import { IDatabaseService } from './IDatabaseService';
import { IPythonBridge } from './IPythonBridge';
import { ILicenseManager } from './ILicenseManager';
import { ITrafficService } from './ITrafficService';
import { IGamingService } from './IGamingService';
import { IDiscoveryService } from './IDiscoveryService';
import { IReconciliationService } from './IReconciliationService';
import { IDeviceManager } from './IDeviceManager';

export interface IServiceContainer {
    databaseService: IDatabaseService;
    pythonBridge: IPythonBridge;
    licenseManager: ILicenseManager;
    trafficService: ITrafficService;
    gamingService: IGamingService;
    discoveryService: IDiscoveryService;
    reconciliationService: IReconciliationService;
    deviceManager: IDeviceManager;

    init(): Promise<void>;
    shutdown(): Promise<void>;
}
