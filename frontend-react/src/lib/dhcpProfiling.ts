export interface DhcpProfileDevice {
    mac?: string;
    ip?: string;
    hostname?: string;
    is_gateway?: boolean;
    is_self?: boolean;
    is_online?: boolean;
    dhcp_fingerprint?: string;
    dhcp_vendor_class?: string;
    dhcp_client_id?: string;
    dhcp_fqdn?: string;
}

export interface DhcpCoverage {
    eligible: number;
    dhcpProfiled: number;
    anyProfiled: number;
    dhcpPercentage: number | null;
    discoveryPercentage: number | null;
}

const hasText = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;

export function hasDhcpEvidence(device: DhcpProfileDevice): boolean {
    return [
        device.dhcp_fingerprint,
        device.dhcp_vendor_class,
        device.dhcp_client_id,
        device.dhcp_fqdn
    ].some(hasText);
}

export function hasAnyProfileEvidence(device: DhcpProfileDevice): boolean {
    if (hasDhcpEvidence(device)) return true;
    const hostname = device.hostname?.trim() || '';
    return Boolean(
        hostname
        && hostname !== device.ip
        && !hostname.toLowerCase().startsWith('unknown')
    );
}

export function calculateDhcpCoverage(
    devices: DhcpProfileDevice[]
): DhcpCoverage {
    const unique = new Map<string, { dhcp: boolean; any: boolean }>();

    for (const device of devices) {
        if (!device.is_online || device.is_gateway || device.is_self) continue;
        const mac = device.mac?.trim().toLowerCase();
        if (!mac) continue;
        const current = unique.get(mac) || { dhcp: false, any: false };
        current.dhcp = current.dhcp || hasDhcpEvidence(device);
        current.any = current.any || hasAnyProfileEvidence(device);
        unique.set(mac, current);
    }

    const eligible = unique.size;
    const dhcpProfiled = Array.from(unique.values())
        .filter(profile => profile.dhcp).length;
    const anyProfiled = Array.from(unique.values())
        .filter(profile => profile.any).length;

    return {
        eligible,
        dhcpProfiled,
        anyProfiled,
        dhcpPercentage: eligible > 0
            ? Math.round((dhcpProfiled / eligible) * 100)
            : null,
        discoveryPercentage: eligible > 0
            ? Math.round((anyProfiled / eligible) * 100)
            : null
    };
}
