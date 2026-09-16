export interface IGamingService {
    getGamingStatus(): Promise<any>;
    toggleGamingMode(enabled: boolean, mode?: string, targetPingMs?: number): Promise<any>;
}
