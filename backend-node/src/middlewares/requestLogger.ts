import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { createChildLogger } from '../utils/logger';

declare global {
    namespace Express {
        interface Request {
            id?: string;
            log?: ReturnType<typeof createChildLogger>;
        }
    }
}

/**
 * Request Tracing & Correlation Middleware
 * - Injects or propagates X-Request-Id header across upstream & downstream
 * - Creates a request-bound child logger with request context
 * - Measures high-precision execution latency (ms) and logs completion
 */
export function requestLogger(): RequestHandler {
    const httpLogger = createChildLogger('HTTP');

    return (req: Request, res: Response, next: NextFunction): void => {
        const rawId = req.headers['x-request-id'];
        const requestId = (typeof rawId === 'string' && rawId.trim()) ? rawId.trim() : crypto.randomUUID();

        req.id = requestId;
        res.setHeader('x-request-id', requestId);

        const startTime = process.hrtime.bigint();
        const reqLog = httpLogger.child({
            requestId,
            method: req.method,
            path: req.originalUrl || req.url,
            ip: req.ip || req.socket.remoteAddress
        });
        req.log = reqLog;

        let logged = false;
        const logCompletion = () => {
            if (logged) return;
            logged = true;

            const elapsedNanos = process.hrtime.bigint() - startTime;
            const durationMs = Number(elapsedNanos) / 1_000_000;
            const statusCode = res.statusCode;

            const logData = {
                statusCode,
                duration_ms: Math.round(durationMs * 100) / 100
            };

            if (statusCode >= 500) {
                reqLog.error(logData, `${req.method} ${req.originalUrl || req.url} ${statusCode} - ${logData.duration_ms}ms`);
            } else if (statusCode >= 400) {
                reqLog.warn(logData, `${req.method} ${req.originalUrl || req.url} ${statusCode} - ${logData.duration_ms}ms`);
            } else {
                reqLog.info(logData, `${req.method} ${req.originalUrl || req.url} ${statusCode} - ${logData.duration_ms}ms`);
            }
        };

        res.on('finish', logCompletion);
        res.on('close', logCompletion);

        next();
    };
}

export default requestLogger;
