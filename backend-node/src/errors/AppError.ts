/**
 * Base Application Error
 * All operational, domain-specific, and invariant errors extend this class.
 */
export abstract class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly isOperational: boolean;
    public readonly details?: unknown;
    public readonly context?: Record<string, unknown>;

    constructor(
        message: string,
        statusCode: number = 500,
        code: string = 'INTERNAL_ERROR',
        isOperational: boolean = true,
        details?: unknown,
        context?: Record<string, unknown>
    ) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = isOperational;
        this.details = details;
        this.context = context;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * 400 Bad Request
 * Thrown when client payload, parameters, or formatting are malformed.
 */
export class BadRequestError extends AppError {
    constructor(message: string = 'Bad request', details?: unknown) {
        super(message, 400, 'BAD_REQUEST', true, details);
    }
}

/**
 * 401 Unauthorized
 * Thrown when required authentication credentials (like SENTINEL_API_TOKEN) are missing or invalid.
 */
export class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized: missing or invalid authentication credentials', details?: unknown) {
        super(message, 401, 'UNAUTHORIZED', true, details);
    }
}

/**
 * 403 Forbidden
 * Thrown when an authenticated entity is not allowed to access a resource (e.g. license tier gate).
 */
export class ForbiddenError extends AppError {
    constructor(message: string = 'Forbidden: access restricted', code: string = 'FORBIDDEN', details?: unknown) {
        super(message, 403, code, true, details);
    }
}

/**
 * 404 Not Found
 * Thrown when a requested resource (device, network, session) does not exist.
 */
export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found', details?: unknown) {
        super(message, 404, 'NOT_FOUND', true, details);
    }
}

/**
 * 409 Conflict
 * Thrown when an operation conflicts with the current state of a resource (e.g. device already actively blocked).
 */
export class ConflictError extends AppError {
    constructor(message: string = 'Resource conflict', details?: unknown) {
        super(message, 409, 'CONFLICT', true, details);
    }
}

/**
 * 400 Invariant Violation
 * Thrown when an operation violates non-negotiable architectural rules:
 * - Invariant 1: Gateway Immunity (Router gateway cannot be cut, throttled, or deleted)
 * - Invariant 2: Controller Self-Protection (Operator host PC cannot be cut or deleted)
 */
export class InvariantViolationError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 400, 'INVARIANT_VIOLATION', true, details);
    }
}

/**
 * 429 Too Many Requests
 * Thrown when rate limit or request threshold is exceeded.
 */
export class TooManyRequestsError extends AppError {
    constructor(message: string = 'Too many requests, please try again later', details?: unknown) {
        super(message, 429, 'TOO_MANY_REQUESTS', true, details);
    }
}

/**
 * 502 / 503 Upstream Service Error
 * Thrown when an upstream microservice (e.g. Python FastAPI engine) fails or is unreachable.
 */
export class UpstreamServiceError extends AppError {
    constructor(message: string = 'Upstream service failure', statusCode: number = 502, code: string = 'UPSTREAM_SERVICE_ERROR', details?: unknown, context?: Record<string, unknown>) {
        super(message, statusCode, code, true, details, context);
    }
}

/**
 * 500 Internal Server Error
 * Thrown when an unexpected error occurs internally on the server.
 */
export class InternalServerError extends AppError {
    constructor(message: string = 'Internal server error', context?: Record<string, unknown>, details?: unknown) {
        super(message, 500, 'INTERNAL_SERVER_ERROR', false, details, context);
    }
}
