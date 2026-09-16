import { CachedLicense } from '../types';

export interface ILicenseRepository {
    saveLicenseCache(lic: CachedLicense): Promise<void>;
    getLicenseCache(): Promise<CachedLicense | null>;
    getCachedLicense(): CachedLicense | null;
    clearLicenseCache(): Promise<void>;
}
