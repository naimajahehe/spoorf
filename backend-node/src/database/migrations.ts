import type Database from 'better-sqlite3';
import { ADDITIVE_DEVICE_COLUMNS } from './schema';

/**
 * Executes backward-compatible migrations on SQLite database.
 * 1. Migrates legacy devices schema (mac-only PK) to Network-Scoped Isolation (composite PK: network_id, mac).
 * 2. Adds additive columns to devices table if missing.
 */
export function runMigrations(db: Database.Database, log?: any): void {
    // Migration check: periksa apakah tabel devices lama belum memiliki kolom network_id
    const existingDeviceCols = db.pragma('table_info(devices)') as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: any;
        pk: number;
    }>;

    // Jika tabel devices belum ada sama sekali, tidak ada yang perlu dimigrasi
    // (tabel baru akan dibuat lengkap oleh CREATE TABLE IF NOT EXISTS)
    if (existingDeviceCols.length === 0) {
        return;
    }

    const hasNetworkId = existingDeviceCols.some(c => c.name === 'network_id');

    if (!hasNetworkId) {
        if (log?.info) {
            log.info('Migrating legacy devices schema to Network-Scoped Isolation (network_id)...');
        }
        const colsDef = existingDeviceCols
            .filter(c => c.name !== 'network_id')
            .map(c => {
                let def = `"${c.name}" ${c.type || 'TEXT'}`;
                if (c.dflt_value !== null && c.dflt_value !== undefined) {
                    let valStr = String(c.dflt_value);
                    if (!valStr.startsWith('(') && !valStr.startsWith("'") && !/^-?\d/.test(valStr) && valStr.toUpperCase() !== 'NULL') {
                        valStr = `(${valStr})`;
                    }
                    def += ` DEFAULT ${valStr}`;
                }
                if (c.notnull && c.name !== 'mac') {
                    def += ' NOT NULL';
                }
                return def;
            });
        const colDefsSql = colsDef.join(',\n                            ');
        const colNames = existingDeviceCols
            .filter(c => c.name !== 'network_id')
            .map(c => `"${c.name}"`)
            .join(', ');

        db.transaction(() => {
            db.exec(`
                ALTER TABLE devices RENAME TO _devices_legacy_migration;
                CREATE TABLE devices (
                    network_id TEXT NOT NULL DEFAULT 'net_default' REFERENCES networks(id) ON DELETE CASCADE,
                    ${colDefsSql},
                    PRIMARY KEY (network_id, mac)
                );
                INSERT INTO devices (network_id, ${colNames})
                SELECT 'net_default', ${colNames} FROM _devices_legacy_migration;
                DROP TABLE _devices_legacy_migration;
            `);
        })();
    }

    // Additive columns migration
    for (const [column, definition] of ADDITIVE_DEVICE_COLUMNS) {
        const currentCols = db.pragma('table_info(devices)') as Array<{ name: string }>;
        if (!currentCols.some(existing => existing.name === column)) {
            db.exec(`ALTER TABLE devices ADD COLUMN ${column} ${definition}`);
        }
    }
}
