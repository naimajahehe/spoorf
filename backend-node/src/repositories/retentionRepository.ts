import type Database from 'better-sqlite3';
import { IRetentionRepository } from '../interfaces';

export class RetentionRepository implements IRetentionRepository {
    constructor(
        private readonly db: Database.Database,
        private readonly log?: any
    ) {}

    /**
     * Retensi: arsipkan (is_archived=1, bukan hapus — reversibel) perangkat "tamu"
     * yang sudah lama hilang, agar daftar mencerminkan jaringan nyata dan bukan
     * riwayat semua tamu. Diproteksi ketat: HANYA baris yang offline, last_seen lebih
     * tua dari `thresholdDays`, DAN tanpa niat pengguna atau identitas yang berharga:
     *   - tidak diblokir (is_blocked=0) dan tanpa sesi spoof (session_id NULL)
     *   - tanpa alias, profile_id, maupun candidate_profile_id
     *   - bukan operator (is_self) maupun gateway
     * Dengan begitu blokir, nama, profil fingerprint, dan sesi aktif tidak pernah hilang.
     * Mengembalikan jumlah baris yang diarsipkan.
     */
    async archiveStaleDevices(thresholdDays: number = 14): Promise<number> {
        const stmt = this.db.prepare(`
            UPDATE devices
            SET is_archived = 1
            WHERE (is_online = 0 OR is_online IS NULL)
              AND last_seen IS NOT NULL
              AND last_seen < datetime('now', 'localtime', '-${Math.max(0, Math.floor(thresholdDays))} days')
              AND (is_blocked IS NULL OR is_blocked = 0)
              AND session_id IS NULL
              AND (alias IS NULL OR alias = '')
              AND profile_id IS NULL
              AND candidate_profile_id IS NULL
              AND (is_self IS NULL OR is_self = 0)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_archived IS NULL OR is_archived = 0)
        `);
        const result = stmt.run();
        if (result.changes > 0 && this.log?.info) {
            this.log.info({ changes: result.changes, thresholdDays }, `[Retention] Mengarsipkan ${result.changes} perangkat tamu yang offline > ${thresholdDays} hari.`);
        }
        return result.changes;
    }

    /**
     * Pembersihan Otomatis (Garbage Collection):
     * Membersihkan entri MAC acak (Randomized MAC) usang yang terbukti sudah offline
     * lebih dari thresholdDays atau terarsipkan, serta profil duplikat 'Target Device' yang tidak memiliki perangkat aktif.
     * PROTEKSI KETAT:
     *   - Perangkat dengan alias kustom pengguna (alias != '' DAN alias != 'Target Device') TIDAK PERNAH DIHAPUS.
     *   - Perangkat fisik asli (is_randomized_mac = 0) TIDAK PERNAH DIHAPUS.
     *   - Komputer Operator (is_self = 1) dan Gateway Router (is_gateway = 1) KEBAL 100%.
     *   - Perangkat yang saat ini ONLINE (is_online = 1) TIDAK PERNAH DIHAPUS.
     *   - Perangkat ber-sesi aktif (session_id IS NOT NULL) TIDAK PERNAH DIHAPUS.
     */
    pruneStaleRandomizedMacs(thresholdDays: number = 2): { deletedDevices: number; deletedProfiles: number } {
        if (!this.db) return { deletedDevices: 0, deletedProfiles: 0 };
        const days = Math.max(1, Math.floor(thresholdDays));

        // 1. Hapus entri MAC acak offline usang (> thresholdDays) yang tidak ber-alias personal, bukan self/gateway, dan TIDAK diblokir
        const deleteDevicesStmt = this.db.prepare(`
            DELETE FROM devices
            WHERE (is_online = 0 OR is_online IS NULL)
              AND is_randomized_mac = 1
              AND session_id IS NULL
              AND (is_self IS NULL OR is_self = 0)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_blocked IS NULL OR is_blocked = 0)
              AND (alias IS NULL OR alias = '' OR alias = 'Target Device')
              AND last_seen IS NOT NULL
              AND last_seen < datetime('now', 'localtime', '-${days} days')
        `);
        // 2. Hapus entri MAC acak yang sudah terarsipkan (is_archived = 1), offline > 1 jam, dan TIDAK diblokir
        const deleteArchivedStmt = this.db.prepare(`
            DELETE FROM devices
            WHERE is_archived = 1
              AND (is_online = 0 OR is_online IS NULL)
              AND is_randomized_mac = 1
              AND session_id IS NULL
              AND (is_self IS NULL OR is_self = 0)
              AND (is_gateway IS NULL OR is_gateway = 0)
              AND (is_blocked IS NULL OR is_blocked = 0)
              AND (alias IS NULL OR alias = '' OR alias = 'Target Device')
              AND last_seen IS NOT NULL
              AND last_seen < datetime('now', 'localtime', '-1 hours')
        `);

        // 3. Bersihkan profil duplikat 'Target Device' yang tidak memiliki perangkat aktif lagi di tabel devices
        const deleteOrphanProfilesStmt = this.db.prepare(`
            DELETE FROM device_profiles
            WHERE alias = 'Target Device'
              AND id NOT IN (SELECT DISTINCT profile_id FROM devices WHERE profile_id IS NOT NULL)
        `);

        const pruneTx = this.db.transaction(() => {
            const devResult = deleteDevicesStmt.run();
            const archResult = deleteArchivedStmt.run();
            const profResult = deleteOrphanProfilesStmt.run();
            return {
                devChanges: devResult.changes,
                archChanges: archResult.changes,
                profChanges: profResult.changes
            };
        });

        const { devChanges, archChanges, profChanges } = pruneTx();
        const totalDeletedDevices = devChanges + archChanges;
        if ((totalDeletedDevices > 0 || profChanges > 0) && this.log?.info) {
            this.log.info({ totalDeletedDevices, deletedProfiles: profChanges }, `[Garbage Collector] Berhasil membersihkan ${totalDeletedDevices} MAC acak usang dan ${profChanges} profil duplikat.`);
        }
        return { deletedDevices: totalDeletedDevices, deletedProfiles: profChanges };
    }
}
