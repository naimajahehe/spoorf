import { Request, Response, NextFunction, RequestHandler } from 'express';
import pinoHttp, { HttpLogger } from 'pino-http';
import crypto from 'crypto';
import { logger, createChildLogger } from '../utils/logger';

declare global {
    namespace Express {
        interface Request {
            id?: string;
            log?: ReturnType<typeof createChildLogger>;
        }
    }
}

const HEALTH_CHECK_PATHS = new Set([
    '/health',
    '/api/health',
    '/healthz',
    '/livez',
    '/readyz'
]);

export function isHealthCheck(url: string = ''): boolean {
    const clean = url.split('?')[0].toLowerCase();
    return HEALTH_CHECK_PATHS.has(clean);
}

/**
 * Cloud-Native Request Tracing & Logging Middleware (pino-http)
 * - Injects / propagates X-Request-Id header across upstream and downstream
 * - Binds req.log contextual child logger
 * - Automatically bypasses Kubernetes probe / health check endpoints
 * - Formats HTTP event completion to Strict Log Contract
 */
export function requestLogger(): RequestHandler {
    const pinoHttpInstance: HttpLogger = pinoHttp({
        logger,
        genReqId: (req: any, res: any) => {
            const rawId = req.headers['x-request-id'];
            const id = (typeof rawId === 'string' && rawId.trim()) ? rawId.trim() : crypto.randomUUID();
            if (typeof res.setHeader === 'function') {
                res.setHeader('x-request-id', id);
            }
            return id;
        },
        autoLogging: {
            ignore: (req: any) => isHealthCheck(req.url || req.originalUrl)
        },
        serializers: {
            req: () => undefined,
            res: () => undefined
        },
        customProps: (req: any, res: any) => {
            const route = req.baseUrl ? `${req.baseUrl}${req.route?.path || req.path}` : (req.route?.path || req.originalUrl || req.url || '');
            const duration_ms = typeof res.responseTime === 'number' ? Math.round(res.responseTime * 100) / 100 : undefined;
            return {
                event: {
                    action: 'http_request_completed',
                    category: 'http'
                },
                http: {
                    method: req.method,
                    route: typeof route === 'string' ? route.split('?')[0] : req.url,
                    status_code: res.statusCode,
                    duration_ms
                }
            };
        },
        customSuccessMessage: (req: any, res: any, responseTime: number) => {
            const duration = Math.round(responseTime * 100) / 100;
            return `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${duration}ms`;
        },
        customErrorMessage: (req: any, res: any, error: Error) => {
            return `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${error.message}`;
        },
        customLogLevel: (_req: any, res: any, err: any) => {
            if (res.statusCode >= 500 || err) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
        }
    });

    return (req: Request, res: Response, next: NextFunction): void => {
        const rawId = req.headers['x-request-id'];
        const requestId = (typeof rawId === 'string' && rawId.trim()) ? rawId.trim() : crypto.randomUUID();
        req.id = requestId;
        if (typeof res.setHeader === 'function') {
            res.setHeader('x-request-id', requestId);
        }

        pinoHttpInstance(req, res, () => {
            if (!req.log) {
                req.log = createChildLogger('HTTP', { requestId, method: req.method, path: req.originalUrl || req.url });
            }
            next();
        });
    };
}

export default requestLogger;
