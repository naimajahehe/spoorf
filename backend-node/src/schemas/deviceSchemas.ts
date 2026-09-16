import { z } from 'zod';

export const BlockDeviceParamsSchema = z.object({
    ip: z.string().min(1, 'Target IP is required')
});

export const BlockDeviceBodySchema = z.object({
    gatewayIp: z.string().optional()
});

export const UnblockDeviceParamsSchema = z.object({
    ip: z.string().min(1, 'Target IP is required')
});

export const SetAliasParamsSchema = z.object({
    mac: z.string().min(1, 'Valid MAC is required')
});

export const SetAliasBodySchema = z.object({
    alias: z.string({
        required_error: 'Valid alias string is required',
        invalid_type_error: 'Valid alias string is required'
    })
});

export const SpeedLimitParamsSchema = z.object({
    ip: z.string().min(1, 'Target IP is required')
});

export const SpeedLimitBodySchema = z.object({
    limit: z.number({
        required_error: 'Numeric speed limit (0-100) is required',
        invalid_type_error: 'Numeric speed limit (0-100) is required'
    }).refine(n => Number.isFinite(n) && !Number.isNaN(n) && n >= 0 && n <= 100, {
        message: 'Numeric speed limit (0-100) is required'
    })
});

export const RedirectDeviceParamsSchema = z.object({
    ip: z.string().min(1, 'Target IP is required')
});

export const RedirectDeviceBodySchema = z.object({
    redirectUrl: z.string({
        required_error: 'Valid redirectUrl string is required',
        invalid_type_error: 'Valid redirectUrl string is required'
    }).min(1, 'Valid redirectUrl string is required'),
    instagramUsername: z.string().optional(),
    gatewayIp: z.string().optional()
});

export const ScanDevicePortsBodySchema = z.object({
    ports: z.array(z.number()).optional()
});

export const DeleteDeviceParamsSchema = z.object({
    mac: z.string().min(1, 'MAC is required')
});
