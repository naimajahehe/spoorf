import { Response, Request, NextFunction, RequestHandler } from 'express';
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

export function respondError(res: Response, err: any, status = 500): void {
    const msg = typeof err?.message === 'string' ? err.message : '';
    // Klasifikasi offline lewat tipe error yang stabil (BridgeUnavailableError.code),
    // bukan substring pesan yang bisa berubah saat terjemahan diubah.
    const isOffline = isBridgeUnavailable(err);
    const isDownstreamValidation =
        isBridgeHttpError(err) &&
        err.status >= 400 &&
        err.status < 500;
    const isFeatureRestricted = err instanceof FeatureLimitError || err instanceof FeatureLockedError;
    if (isOffline || isDownstreamValidation || isFeatureRestricted) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ [API Warning] ${msg || 'Python Engine Offline / Aborted'}`);
    } else {
        // eslint-disable-next-line no-console
        console.error('[API Error]', err);
    }
    const isOperational =
        err instanceof FeatureLimitError ||
        err instanceof FeatureLockedError ||
        isOffline ||
        isDownstreamValidation ||
        isBridgeOperationError(err) ||
        (msg !== '' && OPERATIONAL_ERROR_RE.test(msg));
    const responseStatus = isOffline ? 503 : (isDownstreamValidation ? err.status : (isFeatureRestricted ? 403 : status));
    res.status(responseStatus).json({
        success: false,
        error: isOperational ? msg : 'Terjadi kesalahan internal pada server.'
    });
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
            respondError(res, err);
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
