import { ProfileAssessment } from '../types';

export interface IProfileRepository {
    hasBlockedIdentityMatch(
        data: { client_id?: string; hostname?: string; dhcp_fingerprint?: string; vendor_class?: string },
        networkId?: string
    ): boolean;
    backfillProfileNames(): Promise<number>;
    updateDeviceProfileAssessment(profile: ProfileAssessment, networkId?: string): Promise<void>;
    updateDeviceDhcpProfile(profile: {
        mac: string;
        ip: string;
        hostname?: string;
        vendorClass?: string;
        fingerprint?: string;
        clientId?: string;
        fqdn?: string;
    }, networkId?: string): Promise<void>;
    getProfileById(id: string): any;
    getAllProfiles(): any[];
}
