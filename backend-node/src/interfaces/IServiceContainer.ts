import { IDatabaseService } from './IDatabaseService';
import { IPythonBridge } from './IPythonBridge';
import { ILicenseManager } from './ILicenseManager';
import { ITrafficService } from './ITrafficService';
import { IGamingService } from './IGamingService';
import { IDeviceManager } from './IDeviceManager';

export interface IServiceContainer {
    databaseService: IDatabaseService;
    pythonBridge: IPythonBridge;
    licenseManager: ILicenseManager;
    trafficService: ITrafficService;
    gamingService: IGamingService;
    deviceManager: IDeviceManager;

    init(): Promise<void>;
    shutdown(): Promise<void>;
}
