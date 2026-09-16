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
