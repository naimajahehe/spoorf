import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const HttpUrlSchema = z.string().url().refine(
    val => val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Must be a valid HTTP or HTTPS URL' }
);

export const EnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(5000),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PYTHON_SERVICE_URL: HttpUrlSchema.default('http://127.0.0.1:8001'),
    PYTHON_PATH: z.string().optional(),
    PYTHON_SERVICE_PATH: z.string().optional(),
    AUTO_SPAWN_PYTHON: z.preprocess(v => v === 'true', z.boolean().default(false)),
    SENTINEL_API_TOKEN: z.string().optional(),
    SENTINEL_DB_PATH: z.string().optional(),
    DB_FILE: z.string().optional(),
    ALLOWED_ORIGINS: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    ALLOWED_HOSTS: z.string().optional(),
    SPOORF_CLOUD_URL: HttpUrlSchema.default('https://api.spoorf.app/v1'),
    SPOORF_ALLOW_DEMO_LICENSE: z.preprocess(v => v === 'true', z.boolean().default(false))
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validateEnv(customEnv: Record<string, any> = process.env): EnvConfig {
    const result = EnvSchema.safeParse(customEnv);
    if (!result.success) {
        const errorDetails = result.error.issues
            .map(issue => `  - [${issue.path.join('.')}]: ${issue.message}`)
            .join('\n');
        const message = `[FATAL] Environment configuration error:\n${errorDetails}`;
        // eslint-disable-next-line no-console
        console.error(message);
        throw new Error(message);
    }
    return result.data;
}

export const getEnv = (): EnvConfig => validateEnv(process.env);

export const env: EnvConfig = new Proxy({} as EnvConfig, {
    get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        const current = validateEnv(process.env);
        return (current as any)[prop];
    }
});
