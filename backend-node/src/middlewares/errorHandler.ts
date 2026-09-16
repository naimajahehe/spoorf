import { Response, Request, NextFunction, RequestHandler } from 'express';
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

export function respondError(res: Response, err: any, status = 500, req?: Request): void {
    const msg = typeof err?.message === 'string' ? err.message : '';
    const isAppErr = err instanceof AppError;

    // Klasifikasi offline lewat tipe error yang stabil (BridgeUnavailableError.code),
    // bukan substring pesan yang bisa berubah saat terjemahan diubah.
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
    const logContext = {
        requestId,
        statusCode: responseStatus,
        isOperational,
        errCode: err?.code
    };

    if (isAppErr || isOffline || isDownstreamValidation || isFeatureRestricted) {
        logger.warn({ ...logContext, err }, `[API Warning] ${msg || 'Operational / Domain Warning'}`);
    } else {
        logger.error({ ...logContext, err }, `[API Error] ${msg || 'Unhandled server error'}`);
    }

    const jsonPayload: ErrorEnvelope = {
        success: false,
        error: isOperational ? msg : 'Terjadi kesalahan internal pada server.'
    };

    const errorCode = (isAppErr && err.code) ? err.code : (err?.code && typeof err.code === 'string' ? err.code : undefined);
    if (errorCode && isOperational) {
        jsonPayload.code = errorCode;
    }

    res.status(responseStatus).json(jsonPayload);
}

/**
 * Higher-order controller wrapper that executes the handler and catches
 * operational / unexpected errors cleanly via respondError.
 */
export const safeHandler = (fn: (req: Request, res: Response) => Promise<any> | any): RequestHandler => {
    return async (req: Request, res: Response, _next: NextFunction) => {
        try {
            await fn(req, res);
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
