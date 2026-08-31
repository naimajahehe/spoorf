import { Device } from '../types';

/**
 * Deduplikasi daftar perangkat berdasarkan MAC (case-insensitive), mengutamakan
 * entri yang online dan memiliki timestamp last_seen paling baru bila ada duplikat.
 */
export function dedupeDevicesByMac(list: Device[]): Device[] {
    const dedupMap = new Map<string, Device>();
    for (const d of list) {
        const key = d.mac.toLowerCase();
        const existing = dedupMap.get(key);
        if (!existing) {
            dedupMap.set(key, d);
        } else {
            // Jika status online berbeda: utamakan yang online
            if (!existing.is_online && d.is_online) {
                dedupMap.set(key, d);
            } else if (existing.is_online && !d.is_online) {
                // Pertahankan existing yang online
            } else {
                // Status online sama: utamakan yang memiliki last_seen lebih baru
                const existingTime = existing.last_seen ? new Date(existing.last_seen).getTime() : 0;
                const dTime = d.last_seen ? new Date(d.last_seen).getTime() : 0;
                if (dTime >= existingTime) {
                    dedupMap.set(key, d);
                }
            }
        }
    }
    return Array.from(dedupMap.values());
}

/**
 * Cek apakah perangkat sedang online.
 * Perangkat operator (is_self) selalu dianggap online.
 */
export function isDeviceOnline(device: Device): boolean {
    return Boolean(device.is_self || device.is_online);
}

/**
 * Dapatkan nama representatif perangkat (Prioritas: Alias -> Hostname -> Sistem Operasi (OS) -> Vendor -> IP/Last IP).
 */
export function getResolvedDeviceName(device: Device): string {
    if (device.alias && device.alias.trim() !== '') {
        return device.alias.trim();
    }
    if (device.hostname && device.hostname.trim() !== '' && device.hostname !== device.ip && device.hostname.toLowerCase() !== 'unknown') {
        return device.hostname.trim();
    }
    if (device.os && device.os.trim() !== '' && device.os.toLowerCase() !== 'unknown' && device.os.toLowerCase() !== 'unknown os') {
        return device.os.trim();
    }
    if (device.vendor && device.vendor.trim() !== '' && !device.vendor.toLowerCase().includes('randomized') && !device.vendor.toLowerCase().includes('generic') && device.vendor.toLowerCase() !== 'unknown') {
        return device.vendor.trim();
    }
    return device.ip || device.last_ip || 'Perangkat Jaringan';
}

/**
 * Cek apakah perangkat memiliki nama (alias, hostname, OS, atau Vendor).
 * Jika tidak ada informasi nama apapun selain IP, dianggap belum memiliki nama.
 * Gateway dan This PC (Self) selalu dianggap memiliki nama infrastruktur.
 */
export function hasDeviceName(device: Device): boolean {
    if (device.is_gateway || device.is_self) return true;

    const alias = device.alias?.trim();
    if (alias && alias !== '' && alias !== device.ip) {
        return true;
    }

    const hostname = device.hostname?.trim();
    if (hostname && hostname !== '' && hostname !== device.ip && hostname.toLowerCase() !== 'unknown') {
        return true;
    }

    const os = device.os?.trim();
    if (os && os !== '' && os.toLowerCase() !== 'unknown' && os.toLowerCase() !== 'unknown os') {
        return true;
    }

    const vendor = device.vendor?.trim();
    if (vendor && vendor !== '' && !vendor.toLowerCase().includes('randomized') && !vendor.toLowerCase().includes('generic') && vendor.toLowerCase() !== 'unknown') {
        return true;
    }

    return false;
}

/**
 * Kategori pengurutan sesuai permintaan:
 * 1. Perangkat yang memiliki nama device online
 * 2. Perangkat yang hanya IP online (tanpa nama device)
 * 3. Perangkat yang offline
 */
export function getDeviceCategory(device: Device): number {
    const online = isDeviceOnline(device);
    const named = hasDeviceName(device);

    if (online && named) return 1; // 1. Perangkat nama device online
    if (online && !named) return 2; // 2. Perangkat IP online
    return 3;                      // 3. Perangkat offline
}

/**
 * Konversi IPv4 string ke nilai numerik untuk pengurutan IP yang tepat
 * (misal 192.168.1.2 sebelum 192.168.1.10)
 */
export function ipToNumber(ip: string): number {
    if (!ip) return 0;
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some(isNaN)) return 0;
    return octets[0] * 16777216 + octets[1] * 65536 + octets[2] * 256 + octets[3];
}

/**
 * Fungsi sorting utama untuk list perangkat:
 * 1. Urutkan berdasarkan Kategori (1 -> 2 -> 3)
 * 2. Prioritas Gateway & This PC di posisi teratas dalam kategorinya
 * 3. Jika kategori sama:
 *    - Kategori 1: Urutkan abjad nama, lalu IP
 *    - Kategori 2: Urutkan numerik IP
 *    - Kategori 3: Offline dengan nama di atas offline tanpa nama, lalu urutkan IP
 */
export function sortDevices(a: Device, b: Device): number {
    const catA = getDeviceCategory(a);
    const catB = getDeviceCategory(b);

    if (catA !== catB) {
        return catA - catB;
    }

    // Invariant: Gateway selalu berada paling atas di kategorinya
    if (a.is_gateway !== b.is_gateway) {
        return a.is_gateway ? -1 : 1;
    }

    // Perangkat Controller (This PC) berada tepat setelah Gateway
    if (a.is_self !== b.is_self) {
        return a.is_self ? -1 : 1;
    }

    // Kategori 1: Keduanya online dan memiliki nama
    if (catA === 1) {
        const nameA = (a.alias?.trim() || a.hostname?.trim() || a.ip || a.last_ip || '').toLowerCase();
        const nameB = (b.alias?.trim() || b.hostname?.trim() || b.ip || b.last_ip || '').toLowerCase();
        const nameCmp = nameA.localeCompare(nameB);
        if (nameCmp !== 0) return nameCmp;
        return ipToNumber(a.ip || a.last_ip || '') - ipToNumber(b.ip || b.last_ip || '');
    }

    // Kategori 2: Keduanya online tanpa nama (hanya IP)
    if (catA === 2) {
        return ipToNumber(a.ip || a.last_ip || '') - ipToNumber(b.ip || b.last_ip || '');
    }

    // Kategori 3: Keduanya offline
    const namedA = hasDeviceName(a);
    const namedB = hasDeviceName(b);
    if (namedA !== namedB) {
        return namedA ? -1 : 1;
    }
    if (namedA) {
        const nameA = (a.alias?.trim() || a.hostname?.trim() || a.ip || a.last_ip || '').toLowerCase();
        const nameB = (b.alias?.trim() || b.hostname?.trim() || b.ip || b.last_ip || '').toLowerCase();
        const nameCmp = nameA.localeCompare(nameB);
        if (nameCmp !== 0) return nameCmp;
    }
    return ipToNumber(a.ip || a.last_ip || '') - ipToNumber(b.ip || b.last_ip || '');
}

export type SortField = 'default' | 'device' | 'os' | 'status' | 'distance' | 'last_seen' | 'access';
export type SortOrder = 'asc' | 'desc';

/**
 * Format timestamp last_seen ke tanggal dan jam yang ramah dan konsisten
 * Contoh: "Hari ini, 16:18" atau "29 Agu, 16:18"
 */
export function formatLastSeen(dateStr?: string): string {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;

        const now = new Date();
        const isToday = d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();

        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        if (isToday) {
            return `Hari ini, ${timeStr}`;
        }

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const day = d.getDate();
        const month = months[d.getMonth()];
        return `${day} ${month}, ${timeStr}`;
    } catch {
        return dateStr;
    }
}

export function getDeviceName(device: Device): string {
    return getResolvedDeviceName(device).toLowerCase();
}

export function getDistanceRank(device: Device): number {
    if (device.is_self) return 0;
    if (!isDeviceOnline(device)) return 999;
    switch (device.distance_zone) {
        case 'near': return 1;
        case 'medium': return 2;
        case 'far': return 3;
        default: return 4;
    }
}

export function getStatusRank(device: Device): number {
    if (device.is_gateway || device.is_self) return 0;
    if (device.is_blocked) return 4;
    if (device.is_redirected) return 3;
    if (!isDeviceOnline(device)) return 5;
    if ((device.speed_limit ?? 100) < 100 && (device.speed_limit ?? 100) > 0) return 2;
    return 1; // Online normal
}

/**
 * Mengurutkan list perangkat secara interaktif berdasarkan field dan arah (asc/desc)
 * Tetap menjaga Gateway dan This PC terlindungi di posisi teratas.
 */
export function sortDevicesByField(
    devices: Device[],
    field: SortField,
    order: SortOrder
): Device[] {
    if (field === 'default') {
        const sorted = [...devices].sort(sortDevices);
        return order === 'desc' ? sorted.reverse() : sorted;
    }

    return [...devices].sort((a, b) => {
        // Invariant: Gateway selalu berada di posisi paling atas
        if (a.is_gateway !== b.is_gateway) {
            return a.is_gateway ? -1 : 1;
        }

        // Perangkat Controller (This PC) berada tepat setelah Gateway
        if (a.is_self !== b.is_self) {
            return a.is_self ? -1 : 1;
        }

        let cmp = 0;

        switch (field) {
            case 'device': {
                const nameA = getDeviceName(a);
                const nameB = getDeviceName(b);
                cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                if (cmp === 0) {
                    cmp = ipToNumber(a.ip) - ipToNumber(b.ip);
                }
                break;
            }
            case 'os': {
                const osA = (a.os && a.os.trim() !== '' ? a.os : a.vendor || '-').toLowerCase();
                const osB = (b.os && b.os.trim() !== '' ? b.os : b.vendor || '-').toLowerCase();
                cmp = osA.localeCompare(osB, undefined, { numeric: true, sensitivity: 'base' });
                if (cmp === 0) {
                    cmp = getDeviceName(a).localeCompare(getDeviceName(b));
                }
                break;
            }
            case 'status': {
                const statusA = getStatusRank(a);
                const statusB = getStatusRank(b);
                cmp = statusA - statusB;
                if (cmp === 0) {
                    cmp = getDeviceName(a).localeCompare(getDeviceName(b));
                }
                break;
            }
            case 'last_seen': {
                const timeA = a.last_seen ? new Date(a.last_seen).getTime() : 0;
                const timeB = b.last_seen ? new Date(b.last_seen).getTime() : 0;
                cmp = timeB - timeA; // default terbaru di atas
                if (cmp === 0) {
                    cmp = getDeviceName(a).localeCompare(getDeviceName(b));
                }
                break;
            }
            case 'distance': {
                const distA = getDistanceRank(a);
                const distB = getDistanceRank(b);
                cmp = distA - distB;
                if (cmp === 0) {
                    const rttA = a.rtt_ms || 0;
                    const rttB = b.rtt_ms || 0;
                    cmp = rttA - rttB;
                }
                if (cmp === 0) {
                    cmp = getDeviceName(a).localeCompare(getDeviceName(b));
                }
                break;
            }
            case 'access': {
                const speedA = a.is_blocked ? 0 : (a.speed_limit ?? 100);
                const speedB = b.is_blocked ? 0 : (b.speed_limit ?? 100);
                cmp = speedB - speedA;
                if (cmp === 0) {
                    cmp = getDeviceName(a).localeCompare(getDeviceName(b));
                }
                break;
            }
            default:
                cmp = sortDevices(a, b);
        }

        return order === 'asc' ? cmp : -cmp;
    });
}
