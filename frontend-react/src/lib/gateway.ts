export function findGateway<T extends { is_gateway: boolean }>(devices: readonly T[]): T | null {
    return devices.find(device => device.is_gateway === true) ?? null;
}
