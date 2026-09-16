import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { safeHandler } from './errorHandler';

/**
 * Format Zod validation issue into a clean, human-readable error message.
 */
export function formatZodError(error: ZodError): string {
    if (error.issues && error.issues.length > 0) {
        return error.issues[0].message;
    }
    return 'Invalid request payload';
}

/**
 * Standalone middleware to validate and sanitize request body.
 */
export function validateBody(schema: ZodSchema): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                success: false,
                error: formatZodError(result.error)
            });
            return;
        }
        req.body = result.data;
        next();
    };
}

/**
 * Standalone middleware to validate and sanitize route parameters.
 */
export function validateParams(schema: ZodSchema): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            res.status(400).json({
                success: false,
                error: formatZodError(result.error)
            });
            return;
        }
        req.params = Object.assign(req.params || {}, result.data);
        next();
    };
}

/**
 * Standalone middleware to validate and sanitize query parameters.
 */
export function validateQuery(schema: ZodSchema): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            res.status(400).json({
                success: false,
                error: formatZodError(result.error)
            });
            return;
        }
        req.query = Object.assign(req.query || {}, result.data);
        next();
    };
}

export interface ValidationSchemas {
    body?: ZodSchema;
    params?: ZodSchema;
    query?: ZodSchema;
}

/**
 * Unified validation & execution wrapper.
 * Enforces declarative Zod validation on params, query, and body,
 * sanitizes input, and delegates to the controller inside safeHandler.
 */
export function validateAndHandle(
    schemas: ValidationSchemas,
    handler: (req: Request, res: Response) => Promise<any> | any
): RequestHandler {
    return safeHandler(async (req: Request, res: Response) => {
        if (schemas.params) {
            const result = schemas.params.safeParse(req.params);
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: formatZodError(result.error)
                });
                return;
            }
            req.params = Object.assign(req.params || {}, result.data);
        }

        if (schemas.query) {
            const result = schemas.query.safeParse(req.query);
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: formatZodError(result.error)
                });
                return;
            }
            req.query = Object.assign(req.query || {}, result.data);
        }

        if (schemas.body) {
            const result = schemas.body.safeParse(req.body);
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: formatZodError(result.error)
                });
                return;
            }
            req.body = result.data;
        }

        await handler(req, res);
    });
}
