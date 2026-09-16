import { Network } from '../types';

export interface INetworkRepository {
    ensureNetwork(net: Network): void;
    getNetwork(id: string): Network | null;
    getAllNetworks(): Network[];
}
