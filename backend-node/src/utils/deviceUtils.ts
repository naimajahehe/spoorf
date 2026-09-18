import os from 'os';
import { Device } from '../types';

export const PROFILE_MAC_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function normalizeProfileMac(mac: unknown): string | null {
    if (typeof mac !== 'string') return null;
    const normalized = mac.trim().replace(/-/g, ':').toLowerCase();
    return PROFILE_MAC_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Kunci memori stabil untuk `this.devices`. Perangkat ONLINE memakai IP (kunci alami untuk
 * lookup dari API/event). Perangkat OFFLINE ber-`ip=''` memakai IDENTITAS (profile_id →
 * MAC ternormalisasi) — kalau tidak, SEMUA perangkat offline saling menimpa di kunci ''
 * sehingga hanya satu yang tersisa di memori & UI (BUG-17). Identitas tak pernah berformat IP,
 * jadi tak akan bertabrakan dengan kunci perangkat online.
 */
export function deviceMemKey(d?: Device | (Pick<Device, 'ip' | 'mac'> & Partial<Device>) | null): string {
    if (!d) return '';
    if (d.ip && d.ip.trim() !== '') return d.ip;
    return d.profile_id || normalizeProfileMac(d.mac) || (typeof d.mac === 'string' ? d.mac.toLowerCase() : '');
}

/**
 * Return the ids of ACTIVE spoof sessions that are stale and must be stopped.
 *
 * A block/throttle session pins a fixed (victim_ip, victim_mac). When the target
 * rotates its MAC, gets a new DHCP IP, or leaves, that pin no longer matches any
 * live device — the session then keeps ARP-cutting a stale IP that DHCP may have
 * reassigned to an innocent device (collateral), or nobody (zombie). Both waste
 * engine threads (and, at scale, overload it). A session is stale when there is
 * no currently-online device whose ip AND mac both equal the session's target.
 * Legit sessions (target live at that exact ip+mac) are kept; the auto-reblock
 * path re-creates a fresh session when a blocked identity reappears at a new IP.
 */
export function computeStaleSpoofSessions(
    sessions: Record<string, { victim_ip?: string; victim_mac?: string; active?: boolean }> | null | undefined,
    devices: ReadonlyArray<{ ip?: string; mac?: string; is_online?: boolean }>
): string[] {
    if (!sessions) return [];
    const liveTargets = new Set<string>();
    for (const d of devices || []) {
        if (!d || !d.is_online) continue;
        const ip = (d.ip || '').trim();
        const mac = (d.mac || '').toLowerCase().replace(/-/g, ':');
        if (ip && mac) liveTargets.add(`${ip}|${mac}`);
    }
    const stale: string[] = [];
    for (const [sid, s] of Object.entries(sessions)) {
        if (!s || s.active === false) continue;
        const ip = (s.victim_ip || '').trim();
        const mac = (s.victim_mac || '').toLowerCase().replace(/-/g, ':');
        if (!ip || !mac || !liveTargets.has(`${ip}|${mac}`)) {
            stale.push(sid);
        }
    }
    return stale;
}

export function isPrivateIpv4(ip: unknown): ip is string {
    if (typeof ip !== 'string') return false;
    const text = ip.trim();
    const parts = text.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
    const octets = parts.map(Number);
    if (
        octets.some(part => part < 0 || part > 255)
        || parts.some((part, index) => String(octets[index]) !== part)
    ) {
        return false;
    }
    return octets[0] === 10
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168);
}

export { isGenericProfileLabel } from './databaseUtils';

export function isIpInSameSubnet(ip: string, gatewayIp: string): boolean {
    if (!ip || !gatewayIp) return true;
    try {
        const ipParts = ip.split('.').map(Number);
        const gwParts = gatewayIp.split('.').map(Number);
        if (ipParts.length !== 4 || gwParts.length !== 4) return false;

        // Same /24 (standar rumah & kantor)
        if (ipParts[0] === gwParts[0] && ipParts[1] === gwParts[1] && ipParts[2] === gwParts[2]) {
            return true;
        }

        // Public Wi-Fi Supernets:
        // 10.x.x.x (Class A - Kafe besar / Kampus / Bandara / Hotel)
        if (gwParts[0] === 10 && ipParts[0] === 10) {
            return ipParts[1] === gwParts[1];
        }

        // 172.16.x.x - 172.31.x.x (Class B)
        if (gwParts[0] === 172 && ipParts[0] === 172) {
            return ipParts[1] === gwParts[1];
        }

        // 192.168.x.x (/22 or /20 or /16 supernet)
        if (gwParts[0] === 192 && gwParts[1] === 168 && ipParts[0] === 192 && ipParts[1] === 168) {
            return (ipParts[2] & 0xfc) === (gwParts[2] & 0xfc);
        }

        return false;
    } catch {
        return false;
    }
}

export function ipv4ToInt(ip: string): number | null {
    const parts = (ip || '').trim().split('.');
    if (parts.length !== 4) return null;
    let acc = 0;
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null;
        const n = Number(p);
        if (n > 255) return null;
        acc = acc * 256 + n;
    }
    return acc >>> 0;
}

export function netmaskToPrefix(netmask: string): number | null {
    const n = ipv4ToInt(netmask);
    if (n === null) return null;
    let prefix = 0;
    let seenZero = false;
    for (let i = 31; i >= 0; i--) {
        const bit = (n >>> i) & 1;
        if (bit === 1) {
            if (seenZero) return null;
            prefix++;
        } else {
            seenZero = true;
        }
    }
    return prefix;
}

export function isSameSubnetMasked(ip: string, gatewayIp: string, prefixLen: number): boolean {
    const a = ipv4ToInt(ip);
    const g = ipv4ToInt(gatewayIp);
    if (a === null || g === null) return false;
    if (prefixLen <= 0) return true;
    if (prefixLen >= 32) return a === g;
    const mask = (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
    return ((a & mask) >>> 0) === ((g & mask) >>> 0);
}

export interface NetIfaceLike { address: string; netmask: string; family: string | number; internal: boolean; }

export function resolveActivePrefix(gatewayIp: string, ifaces: NetIfaceLike[]): number | null {
    if (ipv4ToInt(gatewayIp) === null) return null;
    for (const a of ifaces) {
        const isV4 = a.family === 'IPv4' || a.family === 4;
        if (!isV4 || a.internal) continue;
        const prefix = netmaskToPrefix(a.netmask);
        if (prefix === null) continue;
        if (isSameSubnetMasked(a.address, gatewayIp, prefix)) return prefix;
    }
    return null;
}

export function scopeDevicesToActiveSubnet(devices: Device[], gatewayIp?: string, prefixLen?: number): Device[] {
    if (!gatewayIp || prefixLen === undefined || prefixLen === null) return devices;
    return devices.filter(d => isSameSubnetMasked(d.ip || d.last_ip || '', gatewayIp, prefixLen));
}

export function selectGateway(devices: Device[]): Device | undefined {
    const ifaces: NetIfaceLike[] = [];
    try {
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const a of addrs || []) {
                if (a.family === 'IPv4' && !a.internal) {
                    ifaces.push({ address: a.address, netmask: a.netmask, family: a.family, internal: a.internal });
                }
            }
        }
    } catch {}

    const isLocalSubnet = (ip: string): boolean => {
        if (!ip) return false;
        if (ifaces.length === 0) return true;
        return ifaces.some(iface => {
            const prefix = resolveActivePrefix(iface.address, ifaces);
            return prefix !== null && isIpInSameSubnet(ip, iface.address);
        });
    };

    for (const d of devices) {
        if (d.is_gateway && d.is_online && isLocalSubnet(d.ip)) return d;
    }
    for (const d of devices) {
        if (d.is_gateway && d.is_online) return d;
    }
    for (const d of devices) {
        if (d.is_gateway && isLocalSubnet(d.ip)) return d;
    }
    for (const d of devices) {
        if (d.is_gateway) return d;
    }
    for (const d of devices) {
        if (!d.is_self && isLocalSubnet(d.ip) && (d.ip.endsWith('.1') || d.ip.endsWith('.254'))) return d;
    }
    for (const d of devices) {
        if (!d.is_self && (d.ip.endsWith('.1') || d.ip.endsWith('.254'))) return d;
    }
    return undefined;
}
