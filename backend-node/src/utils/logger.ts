import pino, { Logger, LoggerOptions } from 'pino';
import { env } from '../config/env';

/**
 * Enterprise Structured Logging Configuration (Pino)
 * - Zero-blocking asynchronous logging
 * - Automatic sensitive data redaction
 * - Environment-aware transport (Pretty in dev, Raw JSON in prod, Silent in tests)
 */

const isTest = env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test' || process.argv.some(arg => /tests?[\\/]|\brun_tests\b/i.test(arg));
const isDev = env.NODE_ENV === 'development' || (!env.NODE_ENV && process.env.NODE_ENV !== 'production');

const defaultLogLevel = isTest ? 'silent' : (isDev ? 'debug' : 'info');

const redactFields = [
    'req.headers["x-sentinel-token"]',
    'headers["x-sentinel-token"]',
    'req.headers.authorization',
    'headers.authorization',
    'password',
    '*.password',
    'token',
    '*.token',
    'key',
    '*.key',
    'secret',
    '*.secret'
];

const loggerOptions: LoggerOptions = {
    level: process.env.LOG_LEVEL || defaultLogLevel,
    serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err
    },
    redact: {
        paths: redactFields,
        censor: '[REDACTED]'
    },
    timestamp: pino.stdTimeFunctions.isoTime
};

// Use pino-pretty only in interactive dev mode when not running automated tests
if (isDev && !isTest) {
    loggerOptions.transport = {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    };
}

export const logger: Logger = pino(loggerOptions);

/**
 * Creates a child logger with contextual tags.
 * e.g. createChildLogger('DeviceManager') or createChildLogger('HTTP', { requestId })
 */
export function createChildLogger(module: string, bindings?: Record<string, unknown>): Logger {
    return logger.child({ module, ...(bindings || {}) });
}

export default logger;
