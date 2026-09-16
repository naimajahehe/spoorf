import type Database from 'better-sqlite3';
import {
    normalizeMacAddress,
    compareNewestDeviceRows,
    hasStoredValue,
    isGenericProfileLabel,
    normalizeStoredSpeedLimit,
    timestampRank,
    quoteSqlIdentifier
} from '../utils/databaseUtils';

/**
 * Reconciles MAC canonical representations, repairs stale blocked profile artifacts,
 * removes duplicate MAC rows within the same network scope, and ensures database integrity.
 */
export function reconcileCanonicalDeviceMacs(
    db: Database.Database,
    log?: any,
    pruneStaleRandomizedMacsFn?: (days?: number) => any
): void {
    const deviceColumns = db.pragma('table_info(devices)') as Array<{ name: string }>;
    const deviceColumnNames = new Set(deviceColumns.map(column => column.name));
    if (!deviceColumnNames.has('mac')) return;

    const rows = db.prepare('SELECT rowid AS __rowid, * FROM devices').all() as any[];
    const groupedRows = new Map<string, any[]>();
    for (const row of rows) {
        let canonicalMac: string;
        try {
            canonicalMac = normalizeMacAddress(row.mac);
        } catch {
            continue;
        }
        const groupKey = `${row.network_id || 'net_default'}::${canonicalMac}`;
        const group = groupedRows.get(groupKey) || [];
        group.push(row);
        groupedRows.set(groupKey, group);
    }

    const groupsToRepair = Array.from(groupedRows.entries()).filter(
        ([groupKey, group]) => {
            const mac = groupKey.split('::')[1];
            return group.length > 1 || group[0].mac !== mac;
        }
    );
    const canonicalProfileIds = new Map<string, string>();

    const repairTransaction = db.transaction(() => {
        for (const [groupKey, group] of groupsToRepair) {
            const canonicalMac = groupKey.split('::')[1];
            const ordered = [...group].sort(compareNewestDeviceRows);
            const merged = { ...ordered[0], mac: canonicalMac };

            const pickNewestValue = (field: string): any => {
                const source = ordered.find(row => hasStoredValue(row[field]));
                return source ? source[field] : merged[field];
            };
            for (const field of ['hostname', 'vendor', 'os', 'device_type'] as const) {
                if (deviceColumnNames.has(field)) {
                    const identitySource = ordered.find(
                        row => hasStoredValue(row[field]) && !isGenericProfileLabel(row[field], field)
                    );
                    merged[field] = identitySource ? identitySource[field] : pickNewestValue(field);
                }
            }
            for (const field of [
                'web_title',
                'web_server',
                'workgroup',
                'user_name',
                'mac_type',
                'alias',
                'dhcp_vendor_class',
                'dhcp_fingerprint',
                'dhcp_client_id',
                'dhcp_fqdn',
                'candidate_profile_id'
            ]) {
                if (deviceColumnNames.has(field)) {
                    merged[field] = pickNewestValue(field);
                }
            }

            const profileSource = ordered.find(row => hasStoredValue(row.profile_id));
            if (profileSource) {
                merged.profile_id = profileSource.profile_id;
                merged.matched_by = hasStoredValue(profileSource.matched_by)
                    ? profileSource.matched_by
                    : pickNewestValue('matched_by');
                canonicalProfileIds.set(canonicalMac, profileSource.profile_id);
            } else if (deviceColumnNames.has('matched_by')) {
                merged.matched_by = pickNewestValue('matched_by');
            }

            if (deviceColumnNames.has('is_blocked')) {
                merged.is_blocked = group.some(row => Boolean(row.is_blocked)) ? 1 : 0;
            }
            if (deviceColumnNames.has('is_redirected')) {
                merged.is_redirected = group.some(row => Boolean(row.is_redirected)) ? 1 : 0;
            }
            if (deviceColumnNames.has('is_gateway')) {
                merged.is_gateway = group.some(row => Boolean(row.is_gateway)) ? 1 : 0;
            }
            if (deviceColumnNames.has('is_self')) {
                merged.is_self = group.some(row => Boolean(row.is_self)) ? 1 : 0;
            }
            if (deviceColumnNames.has('is_randomized_mac')) {
                merged.is_randomized_mac = group.some(row => Boolean(row.is_randomized_mac)) ? 1 : 0;
            }
            if (deviceColumnNames.has('is_dual_stack')) {
                merged.is_dual_stack = group.some(row => Boolean(row.is_dual_stack)) ? 1 : 0;
            }
            if (deviceColumnNames.has('is_archived')) {
                merged.is_archived = group.every(row => Boolean(row.is_archived)) ? 1 : 0;
            }

            const intentRows = [...ordered].sort((left, right) => {
                const rightIntent = Number(Boolean(right.is_blocked || right.is_redirected || hasStoredValue(right.session_id)));
                const leftIntent = Number(Boolean(left.is_blocked || left.is_redirected || hasStoredValue(left.session_id)));
                return rightIntent - leftIntent || compareNewestDeviceRows(left, right);
            });
            if (deviceColumnNames.has('session_id')) {
                const sessionSource = intentRows.find(row => hasStoredValue(row.session_id));
                merged.session_id = sessionSource ? sessionSource.session_id : merged.session_id;
            }
            if (deviceColumnNames.has('redirect_url')) {
                const redirectSource = intentRows.find(
                    row => Boolean(row.is_redirected) && hasStoredValue(row.redirect_url)
                ) || intentRows.find(row => hasStoredValue(row.redirect_url));
                merged.redirect_url = redirectSource ? redirectSource.redirect_url : merged.redirect_url;
            }
            if (deviceColumnNames.has('speed_limit')) {
                merged.speed_limit = Math.min(
                    ...group.map(row => normalizeStoredSpeedLimit(row.speed_limit))
                );
            }

            const assessmentSource = [...ordered].sort((left, right) => {
                const rightHasAssessment = Number(hasStoredValue(right.profiled_at));
                const leftHasAssessment = Number(hasStoredValue(left.profiled_at));
                if (rightHasAssessment !== leftHasAssessment) {
                    return rightHasAssessment - leftHasAssessment;
                }
                const leftProfiledAt = timestampRank(left.profiled_at);
                const rightProfiledAt = timestampRank(right.profiled_at);
                const profiledDifference = leftProfiledAt === rightProfiledAt
                    ? 0
                    : rightProfiledAt > leftProfiledAt ? 1 : -1;
                if (profiledDifference !== 0) return profiledDifference;
                const versionDifference = Number(right.profile_version || 0) - Number(left.profile_version || 0);
                return versionDifference || compareNewestDeviceRows(left, right);
            })[0];
            for (const field of [
                'profile_status',
                'vendor_confidence',
                'type_confidence',
                'hostname_confidence',
                'profile_evidence',
                'profiled_at',
                'profile_version'
            ]) {
                if (deviceColumnNames.has(field)) {
                    merged[field] = assessmentSource[field];
                }
            }

            if (deviceColumnNames.has('first_seen')) {
                const firstSeenSource = [...group]
                    .filter(row => hasStoredValue(row.first_seen))
                    .sort((left, right) => {
                        const leftFirstSeen = timestampRank(left.first_seen);
                        const rightFirstSeen = timestampRank(right.first_seen);
                        const difference = leftFirstSeen === rightFirstSeen
                            ? 0
                            : leftFirstSeen < rightFirstSeen ? -1 : 1;
                        return difference || String(left.first_seen).localeCompare(String(right.first_seen));
                    })[0];
                if (firstSeenSource) merged.first_seen = firstSeenSource.first_seen;
            }

            const survivor = group.find(row => row.mac === canonicalMac) || ordered[0];
            const deleteRow = db.prepare('DELETE FROM devices WHERE rowid = ?');
            for (const row of group) {
                if (row.__rowid !== survivor.__rowid) deleteRow.run(row.__rowid);
            }

            const assignments = deviceColumns
                .map(column => `${quoteSqlIdentifier(column.name)} = ?`)
                .join(', ');
            db.prepare(`UPDATE devices SET ${assignments} WHERE rowid = ?`).run(
                ...deviceColumns.map(column => merged[column.name]),
                survivor.__rowid
            );
        }

        const profileColumns = db.pragma('table_info(device_profiles)') as Array<{ name: string }>;
        if (
            profileColumns.some(column => column.name === 'id')
            && profileColumns.some(column => column.name === 'linked_macs')
        ) {
            const profiles = db.prepare('SELECT id, linked_macs FROM device_profiles').all() as any[];
            const updateLinkedMacs = db.prepare(
                'UPDATE device_profiles SET linked_macs = ? WHERE id = ?'
            );
            for (const profile of profiles) {
                let linkedMacs: unknown;
                try {
                    linkedMacs = JSON.parse(profile.linked_macs || '[]');
                } catch {
                    continue;
                }
                if (!Array.isArray(linkedMacs)) continue;

                const repaired: unknown[] = [];
                const seen = new Set<string>();
                for (const linkedMac of linkedMacs) {
                    let value = linkedMac;
                    if (typeof linkedMac === 'string') {
                        try {
                            value = normalizeMacAddress(linkedMac);
                        } catch {
                            value = linkedMac;
                        }
                    }
                    const key = typeof value === 'string'
                        ? `string:${value.toLowerCase()}`
                        : `json:${JSON.stringify(value)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        repaired.push(value);
                    }
                }
                for (const [canonicalMac, profileId] of canonicalProfileIds) {
                    if (profileId === profile.id && !seen.has(`string:${canonicalMac}`)) {
                        seen.add(`string:${canonicalMac}`);
                        repaired.push(canonicalMac);
                    }
                }

                const serialized = JSON.stringify(repaired);
                if (serialized !== profile.linked_macs) {
                    updateLinkedMacs.run(serialized, profile.id);
                }
            }
        }
    });

    repairTransaction();

    // REPAIR STALE BLOCKED ARTIFACTS:
    // Jika suatu profil memiliki perangkat aktif/online yang TIDAK diblokir (is_blocked=0) di suatu jaringan,
    // maka seluruh entri historis/offline milik profil tersebut di jaringan yang sama harus diselaraskan
    // ke is_blocked = 0 dan speed_limit = 100.
    // Mencegah bug rotasi MAC di mana entri offline basi menyebabkan auto-reblock membangkitkan blokir palsu.
    try {
        db.prepare(`
            UPDATE devices AS d1
            SET is_blocked = 0, session_id = NULL, speed_limit = 100
            WHERE d1.is_blocked = 1
              AND d1.profile_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM devices AS d2
                  WHERE d2.network_id = d1.network_id
                    AND d2.profile_id = d1.profile_id
                    AND d2.is_online = 1
                    AND d2.is_blocked = 0
              )
        `).run();
    } catch (err: any) {
        if (log?.warn) {
            log.warn({ err }, `Notice repair stale blocked profile rows: ${err?.message || err}`);
        }
    }

    // Pembersihan Integritas Controller: Perangkat yang offline tidak boleh memiliki flag is_self = 1
    try {
        db.exec("UPDATE devices SET is_self = 0 WHERE is_self = 1 AND is_online = 0;");
    } catch (err: any) {
        if (log?.warn) {
            log.warn({ err }, `Notice sanitize offline controller is_self: ${err?.message || err}`);
        }
    }

    // Normalisasi data OS: bersihkan legacy string seperti 'Android / Linux' atau 'Android OS' menjadi 'Android'
    try {
        db.exec("UPDATE devices SET os = 'Android' WHERE os IN ('Android / Linux', 'Android OS');");
    } catch (err: any) {
        if (log?.warn) {
            log.warn({ err }, `Notice normalize OS names: ${err?.message || err}`);
        }
    }

    // PEMBERSIHAN OTOMATIS (GARBAGE COLLECTOR):
    // Bersihkan MAC acak usang yang terarsipkan atau offline > 2 hari saat startup
    if (typeof pruneStaleRandomizedMacsFn === 'function') {
        try {
            pruneStaleRandomizedMacsFn(2);
        } catch (err: any) {
            if (log?.warn) {
                log.warn({ err }, `Notice prune stale randomized MACs on init: ${err?.message || err}`);
            }
        }
    }
}
