import { z } from 'zod';

export const ShieldToggleBodySchema = z.object({
    enabled: z.boolean({
        required_error: 'enabled boolean is required',
        invalid_type_error: 'enabled boolean is required'
    }),
    mode: z.string().optional().default('host_lock'),
    autoRetaliate: z.boolean().optional().default(false),
    lanTargets: z.array(z.string()).optional().default([])
});

export const ShieldModeBodySchema = z.object({
    mode: z.string().optional().default('host_lock'),
    autoRetaliate: z.boolean().optional().default(false)
});
