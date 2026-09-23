import { z } from 'zod';
import dotenv from 'dotenv';

// Build terpaket tidak membaca .env dari working directory (lihat applyPackagedLockdown).
if (process.env.SPOORF_PACKAGED !== 'true') {
    dotenv.config();
}

const HttpUrlSchema = z.string().url().refine(
    val => val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Must be a valid HTTP or HTTPS URL' }
);

export const OFFICIAL_CLOUD_URL = 'https://api.spoorf.app/v1';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Kredensial & token dikirim ke endpoint ini: wajib HTTPS, kecuali instance cloud lokal (dev).
const CloudUrlSchema = HttpUrlSchema.refine(
    val => {
        try {
            const url = new URL(val);
            return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
        } catch {
            return false;
        }
    },
    { message: 'SPOORF_CLOUD_URL must use HTTPS (plain HTTP is only allowed for loopback dev instances)' }
);

export const EnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(5000),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    SERVICE_NAME: z.string().default('netcut-backend'),
    APP_VERSION: z.string().default('1.0.0'),
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
    SPOORF_CLOUD_URL: CloudUrlSchema.default(OFFICIAL_CLOUD_URL),
    SPOORF_ALLOW_DEMO_LICENSE: z.preprocess(v => v === 'true', z.boolean().default(false)),
    // Diset oleh Electron main (bukan oleh pengguna) saat aplikasi berjalan dari installer.
    SPOORF_PACKAGED: z.preprocess(v => v === 'true', z.boolean().default(false)),
    // Batas waktu (ms) untuk auth cloud. Default 5000 (bukan 800 yang lama & agresif)
    // agar login sah lewat koneksi lambat tak keburu di-abort saat fallback demo nonaktif.
    SPOORF_CLOUD_AUTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000)
});

export type EnvConfig = z.infer<typeof EnvSchema>;

/**
 * Build terpaket (installer) mengabaikan override lisensi dari environment pengguna:
 * mode demo selalu nonaktif dan endpoint cloud dikunci ke endpoint resmi.
 */
export function applyPackagedLockdown(config: EnvConfig): EnvConfig {
    if (!config.SPOORF_PACKAGED) return config;
    return {
        ...config,
        SPOORF_ALLOW_DEMO_LICENSE: false,
        SPOORF_CLOUD_URL: OFFICIAL_CLOUD_URL
    };
}

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
    return applyPackagedLockdown(result.data);
}

export const getEnv = (): EnvConfig => validateEnv(process.env);

export const env: EnvConfig = new Proxy({} as EnvConfig, {
    get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        const current = validateEnv(process.env);
        return (current as any)[prop];
    }
});
