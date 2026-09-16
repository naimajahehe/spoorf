import type Database from 'better-sqlite3';
import { Network } from '../types';
import { INetworkRepository } from '../interfaces';

export class NetworkRepository implements INetworkRepository {
    constructor(private readonly db: Database.Database) {}

    ensureNetwork(net: Network): void {
        const stmt = this.db.prepare(`
            INSERT INTO networks (id, ssid, gateway_ip, gateway_mac, subnet, interface_type, last_connected_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(id) DO UPDATE SET
                ssid = excluded.ssid,
                gateway_ip = excluded.gateway_ip,
                gateway_mac = excluded.gateway_mac,
                subnet = COALESCE(excluded.subnet, networks.subnet),
                interface_type = COALESCE(excluded.interface_type, networks.interface_type),
                last_connected_at = datetime('now', 'localtime')
        `);
        stmt.run(
            net.id,
            net.ssid,
            net.gateway_ip,
            net.gateway_mac,
            net.subnet || null,
            net.interface_type || 'wifi'
        );
    }

    getNetwork(id: string): Network | null {
        const row = this.db.prepare('SELECT * FROM networks WHERE id = ?').get(id) as any;
        if (!row) return null;
        return {
            id: row.id,
            ssid: row.ssid,
            gateway_ip: row.gateway_ip,
            gateway_mac: row.gateway_mac,
            subnet: row.subnet || undefined,
            interface_type: row.interface_type || undefined,
            created_at: row.created_at,
            last_connected_at: row.last_connected_at
        };
    }

    getAllNetworks(): Network[] {
        const rows = this.db.prepare('SELECT * FROM networks ORDER BY last_connected_at DESC').all() as any[];
        return rows.map(row => ({
            id: row.id,
            ssid: row.ssid,
            gateway_ip: row.gateway_ip,
            gateway_mac: row.gateway_mac,
            subnet: row.subnet || undefined,
            interface_type: row.interface_type || undefined,
            created_at: row.created_at,
            last_connected_at: row.last_connected_at
        }));
    }
}
