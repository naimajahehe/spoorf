// Shared, backend-aligned definitions for passive identity profiling coverage.
// The backend (Python classifier + Node persistence) is the source of truth for
// `profile_status`; the frontend only re-checks that vendor and category are
// non-generic so a "high" label is never counted while the row is still generic.

export interface ProfileDevice {
    mac?: string;
    ip?: string;
    hostname?: string;
    vendor?: string;
    device_type?: string;
    is_gateway?: boolean;
    is_self?: boolean;
    is_online?: boolean;
    profile_status?: string;
    vendor_confidence?: number;
    type_confidence?: number;
}

export interface ProfileCoverage {
    visible: number;
    highConfidence: number;
    mediumConfidence: number;
    unknown: number;
    hostnameCount: number;
    coveragePercentage: number | null;
}

// Labels the backend emits for a device it could NOT resolve to a real identity.
const GENERIC_VENDOR_LABELS = new Set([
    '',
    'unknown',
    'generic device',
    'router / gateway',
    'private device (randomized mac)'
]);

const GENERIC_TYPE_LABELS = new Set([
    '',
    'unknown',
    'generic device',
    'generic client device'
]);

const normalize = (value: unknown): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

export function isIdentifiedVendor(device: ProfileDevice): boolean {
    return !GENERIC_VENDOR_LABELS.has(normalize(device.vendor));
}

export function isIdentifiedType(device: ProfileDevice): boolean {
    return !GENERIC_TYPE_LABELS.has(normalize(device.device_type));
}

// High confidence = backend 'high' status AND a non-generic vendor AND a
// non-generic category. Matches the shared coverage definition in the spec.
export function isHighConfidenceProfile(device: ProfileDevice): boolean {
    return (
        normalize(device.profile_status) === 'high'
        && isIdentifiedVendor(device)
        && isIdentifiedType(device)
    );
}

function isMediumConfidenceProfile(device: ProfileDevice): boolean {
    if (isHighConfidenceProfile(device)) return false;
    return normalize(device.profile_status) === 'medium';
}

function hasIdentifyingHostname(device: ProfileDevice): boolean {
    const hostname = normalize(device.hostname);
    return Boolean(
        hostname
        && hostname !== normalize(device.ip)
        && !hostname.startsWith('unknown')
    );
}

// Coverage over visible, eligible devices (online, not gateway, not controller),
// de-duplicated by MAC. Unknown devices remain in the denominator by design.
export function calculateProfileCoverage(devices: ProfileDevice[]): ProfileCoverage {
    const unique = new Map<string, ProfileDevice>();

    for (const device of devices) {
        if (!device.is_online || device.is_gateway || device.is_self) continue;
        const mac = device.mac?.trim().toLowerCase();
        if (!mac) continue;
        // Prefer the first seen; a later high-confidence row upgrades it.
        const existing = unique.get(mac);
        if (!existing || (!isHighConfidenceProfile(existing) && isHighConfidenceProfile(device))) {
            unique.set(mac, device);
        }
    }

    const visibleDevices = Array.from(unique.values());
    const visible = visibleDevices.length;
    let highConfidence = 0;
    let mediumConfidence = 0;
    let hostnameCount = 0;

    for (const device of visibleDevices) {
        if (isHighConfidenceProfile(device)) highConfidence += 1;
        else if (isMediumConfidenceProfile(device)) mediumConfidence += 1;
        if (hasIdentifyingHostname(device)) hostnameCount += 1;
    }

    const unknown = visible - highConfidence - mediumConfidence;

    return {
        visible,
        highConfidence,
        mediumConfidence,
        unknown,
        hostnameCount,
        coveragePercentage: visible > 0
            ? Math.round((highConfidence / visible) * 100)
            : null
    };
}
