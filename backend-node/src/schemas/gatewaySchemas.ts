import { z } from 'zod';

export const StartGatewayBodySchema = z.object({
    ip: z.string({
        required_error: 'Valid IP string is required',
        invalid_type_error: 'Valid IP string is required'
    }).min(1, 'Valid IP string is required'),
    gatewayIp: z.string().optional()
});

export const StopGatewayBodySchema = z.object({
    ip: z.string({
        required_error: 'Valid IP string is required',
        invalid_type_error: 'Valid IP string is required'
    }).min(1, 'Valid IP string is required')
});

export const SinkholeDomainBodySchema = z.object({
    domain: z.string({
        required_error: 'Valid domain string is required',
        invalid_type_error: 'Valid domain string is required'
    }).min(1, 'Valid domain string is required')
});

export const GatewayLogsQuerySchema = z.object({
    limit: z.coerce.number().int().positive().optional().default(100)
});
