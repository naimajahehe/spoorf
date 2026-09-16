import { z } from 'zod';

export const GamingToggleBodySchema = z.object({
    enabled: z.boolean().optional().default(false),
    mode: z.string().optional(),
    target_ping_ms: z.number().optional()
});
