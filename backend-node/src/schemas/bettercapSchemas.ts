import { z } from 'zod';
import { isPrivateIpv4 } from '../services/deviceManager';

export const AddDnsRuleBodySchema = z.object({
    domain: z.string({
        required_error: 'Domain is required',
        invalid_type_error: 'Domain is required'
    }).min(1, 'Domain is required'),
    target_ip: z.string().optional(),
    action: z.string().optional(),
    is_enabled: z.boolean().optional()
});

export const UpdateDnsRuleBodySchema = z.object({
    domain: z.string().optional(),
    target_ip: z.string().optional(),
    action: z.string().optional(),
    is_enabled: z.boolean().optional()
});

export const BettercapDnsHostsBodySchema = z.object({
    content: z.string({
        required_error: 'content is required',
        invalid_type_error: 'content is required'
    }).min(1, 'content is required'),
    default_address: z.string().optional(),
    action: z.string().optional()
});

export const BettercapDnsTtlBodySchema = z.object({
    ttl: z.coerce.number().optional().default(10)
});

export const BettercapDnsSpoofAllBodySchema = z.object({
    enabled: z.boolean().optional().default(false),
    address: z.string().optional().default('')
});

export const BettercapCredentialsQuerySchema = z.object({
    limit: z.coerce.number().int().positive().optional().default(100)
});

export const BettercapSynScanBodySchema = z.object({
    target_ip: z.string({
        required_error: 'Target IP is required',
        invalid_type_error: 'Target IP is required'
    })
    .min(1, 'Target IP is required')
    .refine(ip => isPrivateIpv4(ip), {
        message: 'Target IP must be an RFC 1918 private address'
    }),
    ports: z.union([z.string(), z.array(z.number())]).optional(),
    profile: z.string().optional()
});
