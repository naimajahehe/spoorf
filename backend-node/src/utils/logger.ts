import pino, { Logger, LoggerOptions } from 'pino';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { env } from '../config/env';

/**
 * Cloud-Native Strict Observability & Logging Engine (Pino + OpenTelemetry)
 * - Complies with ECS & OpenTelemetry Strict Log Contract
 * - Zero-blocking asynchronous streaming to stdout (12-Factor App)
 * - Automatic sensitive data & PII redaction
 * - Automatic OpenTelemetry trace & span metadata injection via mixin
 * - Environment-aware (Silent in automated test suites unless LOG_LEVEL is set)
 */

const isTest = env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test' || process.argv.some(arg => /tests?[\\/]|\brun_tests\b/i.test(arg));
const defaultLogLevel = isTest ? 'silent' : (env.NODE_ENV === 'production' ? 'info' : 'debug');

const redactFields = [
    'req.headers.authorization',
    'headers.authorization',
    'req.headers.cookie',
    'headers.cookie',
    'req.headers["x-sentinel-token"]',
    'headers["x-sentinel-token"]',
    'password',
    '*.password',
    'token',
    '*.token',
    'secret',
    '*.secret',
    'cvv',
    '*.cvv',
    'apiKey',
    '*.apiKey',
    'context.password',
    'context.token'
];

export const loggerOptions: LoggerOptions = {
    level: process.env.LOG_LEVEL || defaultLogLevel,
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
        level: (label: string) => ({ level: label.toUpperCase() })
    },
    base: {
        service: {
            name: env.SERVICE_NAME || 'netcut-backend',
            version: env.APP_VERSION || '1.0.0',
            environment: env.NODE_ENV || 'development'
        }
    },
    mixin: () => {
        try {
            const activeSpan = trace.getActiveSpan();
            if (activeSpan) {
                const spanContext = activeSpan.spanContext();
                if (spanContext && isSpanContextValid(spanContext)) {
                    return {
                        trace: {
                            trace_id: spanContext.traceId,
                            span_id: spanContext.spanId
                        }
                    };
                }
            }
        } catch {
            // Ignore tracer lookup failure
        }
        return {};
    },
    serializers: {
        err: (err: any) => {
            if (!err) return err;
            return {
                name: err.name || 'Error',
                message: err.message || String(err),
                stack: err.stack || '',
                is_operational: typeof err.isOperational === 'boolean'
                    ? err.isOperational
                    : (typeof err.statusCode === 'number' ? err.statusCode < 500 : false)
            };
        },
        error: (err: any) => {
            if (!err) return err;
            return {
                name: err.name || 'Error',
                message: err.message || String(err),
                stack: err.stack || '',
                is_operational: typeof err.isOperational === 'boolean'
                    ? err.isOperational
                    : (typeof err.statusCode === 'number' ? err.statusCode < 500 : false)
            };
        }
    },
    redact: {
        paths: redactFields,
        censor: '[REDACTED]'
    }
};

/**
 * Pure JSON streaming singleton writing to stdout (12-Factor App)
 */
export const logger: Logger = pino(loggerOptions, process.stdout);

/**
 * Creates a child logger with contextual tags.
 * e.g. createChildLogger('DeviceManager') or createChildLogger('HTTP', { requestId })
 */
export function createChildLogger(module: string, bindings?: Record<string, unknown>): Logger {
    return logger.child({ module, ...(bindings || {}) });
}

export default logger;
