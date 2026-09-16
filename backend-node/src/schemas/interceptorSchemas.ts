import { z } from 'zod';

export const LeafCertBodySchema = z.object({
    domain: z.string({
        required_error: 'Domain parameter is required',
        invalid_type_error: 'Domain parameter is required'
    }).trim().min(1, 'Domain parameter is required')
});

export const FlowsQuerySchema = z.object({
    limit: z.coerce.number().int().positive().optional().default(100),
    search: z.string().optional(),
    scheme: z.string().optional(),
    method: z.string().optional(),
    is_blocked: z.preprocess((val) => {
        if (typeof val === 'string') {
            if (val.toLowerCase() === 'true') return true;
            if (val.toLowerCase() === 'false') return false;
        }
        return val;
    }, z.boolean().optional())
});
