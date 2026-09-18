import { Response, Request, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';
import {
    FeatureLimitError,
    FeatureLockedError
} from '../services/licenseManager';
import {
    isBridgeHttpError,
    isBridgeOperationError,
    isBridgeUnavailable
} from '../services/pythonBridge';

/**
 * KEAMANAN (P2): Sanitasi respons error 500 — hindari kebocoran detail internal.
 * Detail lengkap selalu di-log ke server; klien hanya menerima pesan operasional
 * yang dikenal (validasi/feature-gate/"not found"), selain itu pesan generik.
 */
const OPERATIONAL_ERROR_RE = /not found|required|already|invalid|cannot|gateway|tidak valid|tidak ditemukan|tidak merespons|diperlukan|dilindungi|kebal|di luar jangkauan|terkunci|format|batas|upgrade/i;

export interface ErrorEnvelope {
    success: false;
    error: string;
    code?: string;
}

/**
 * Standardized Error Responder
 * - Formats output to comply with Strict Log Contract
 * - Enforces "Log or Throw, Never Both": this is the single point of truth for logging API errors
 * - Sanitizes 500 errors to prevent leaking internal stack traces or database structures
 */
export function respondError(res: Response, err: any, status = 500, req?: Request): void {
    const msg = typeof err?.message === 'string' ? err.message : '';
    const isAppErr = err instanceof AppError;

    const isOffline = isBridgeUnavailable(err);
    const isDownstreamValidation =
        isBridgeHttpError(err) &&
        err.status >= 400 &&
        err.status < 500;
    const isFeatureRestricted = err instanceof FeatureLimitError || err instanceof FeatureLockedError;

    const isOperational =
        isAppErr ||
        err instanceof FeatureLimitError ||
        err instanceof FeatureLockedError ||
        isOffline ||
        isDownstreamValidation ||
        isBridgeOperationError(err) ||
        (msg !== '' && OPERATIONAL_ERROR_RE.test(msg));

    let responseStatus: number;
    if (isAppErr) {
        responseStatus = err.statusCode;
    } else if (isOffline) {
        responseStatus = 503;
    } else if (isDownstreamValidation) {
        responseStatus = err.status;
    } else if (isFeatureRestricted) {
        responseStatus = 403;
    } else {
        responseStatus = status;
    }

    const requestId = req?.id || (typeof res.getHeader === 'function' ? (res.getHeader('x-request-id') as string) : undefined);
    const route = req?.originalUrl || req?.url || (req?.route?.path as string) || undefined;

    if (responseStatus >= 500 || !isOperational) {
        // ERROR: Hanya untuk kegagalan operasi/request tak terduga (5xx). Wajib mempopulasikan field error.
        logger.error({
            event: {
                action: 'unhandled_server_error',
                category: 'system'
            },
            http: req ? {
                method: req.method,
                route,
                status_code: responseStatus
            } : undefined,
            context: {
                ...(err?.context || {}),
                ...(requestId ? { requestId } : {})
            },
            error: {
                name: err?.name || 'Error',
                message: msg || 'Unhandled server error',
                stack: err?.stack || '',
                is_operational: false
            }
        }, `[API Error] ${msg || 'Unhandled server error'}`);
    } else {
        // WARN: Anomali atau error operasional/validasi (4xx)
        logger.warn({
            event: {
                action: 'operational_warning',
                category: 'system'
            },
            http: req ? {
                method: req.method,
                route,
                status_code: responseStatus
            } : undefined,
            context: {
                ...(err?.context || {}),
                ...(requestId ? { requestId } : {}),
                errCode: err?.code
            }
        }, `[API Warning] ${msg || 'Operational / Domain Warning'}`);
    }

    const jsonPayload: ErrorEnvelope = {
        success: false,
        error: isOperational ? msg : 'Terjadi kesalahan internal pada server.'
    };

    const errorCode = (isAppErr && err.code) ? err.code : (err?.code && typeof err.code === 'string' ? err.code : undefined);
    if (errorCode && isOperational) {
        jsonPayload.code = errorCode;
    }

    // Jika respons sudah mulai dikirim (handler telanjur menulis lalu throw), mengirim
    // ulang memicu ERR_HTTP_HEADERS_SENT & meng-crash proses. Logging di atas tetap jalan
    // (titik-log tunggal); di sini cukup lewati pengiriman body kedua.
    if (res.headersSent) {
        return;
    }

    res.status(responseStatus).json(jsonPayload);
}

/**
 * Centralized Express 4-parameter error handler middleware (err, req, res, next)
 * Adheres to Cloud-Native production-grade single boundary logging.
 */
export const centralizedErrorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, _next: NextFunction): void => {
    respondError(res, err, 500, req);
};

/**
 * Higher-order controller wrapper that executes the handler and catches
 * operational / unexpected errors cleanly via respondError.
 */
export const safeHandler = (fn: (req: Request, res: Response, next?: NextFunction) => Promise<any> | any): RequestHandler => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await fn(req, res, next);
        } catch (err: any) {
            respondError(res, err, 500, req);
        }
    };
};

/**
 * Parse integer positif dari query param dengan fallback aman (P3).
 * Mencegah `NaN` diteruskan ke engine saat input tidak valid (mis. ?limit=abc).
 */
export function parsePositiveInt(value: unknown, fallback: number): number {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default centralizedErrorHandler;
