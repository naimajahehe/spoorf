export interface IRetentionRepository {
    archiveStaleDevices(thresholdDays?: number): Promise<number>;
    pruneStaleRandomizedMacs(thresholdDays?: number): { deletedDevices: number; deletedProfiles: number };
}
