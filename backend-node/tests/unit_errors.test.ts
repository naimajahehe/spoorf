import assert from 'assert';
import {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    InvariantViolationError,
    UpstreamServiceError
} from '../src/errors';
import { FeatureLimitError, FeatureLockedError } from '../src/services/licenseManager';
import { respondError } from '../src/middlewares/errorHandler';

function createMockResponse() {
    let statusCode = 200;
    let responseBody: any = null;
    const res: any = {
        status: (code: number) => {
            statusCode = code;
            return res;
        },
        json: (data: any) => {
            responseBody = data;
            return res;
        },
        getStatusCode: () => statusCode,
        getBody: () => responseBody
    };
    return res;
}

export async function runErrorTests() {
    console.log('\n--- [Node] Testing Centralized Typed Domain Error Hierarchy ---');

    // 1. AppError Hierarchy and Inheritance
    {
        const badReq = new BadRequestError('Invalid query format');
        assert.strictEqual(badReq.statusCode, 400);
        assert.strictEqual(badReq.code, 'BAD_REQUEST');
        assert.strictEqual(badReq.isOperational, true);
        assert.ok(badReq instanceof AppError);
        assert.ok(badReq instanceof Error);

        const unauth = new UnauthorizedError('Token required');
        assert.strictEqual(unauth.statusCode, 401);
        assert.strictEqual(unauth.code, 'UNAUTHORIZED');

        const forbidden = new ForbiddenError('Access denied');
        assert.strictEqual(forbidden.statusCode, 403);
        assert.strictEqual(forbidden.code, 'FORBIDDEN');

        const notFound = new NotFoundError('Device 192.168.1.55 not found');
        assert.strictEqual(notFound.statusCode, 404);
        assert.strictEqual(notFound.code, 'NOT_FOUND');

        const conflict = new ConflictError('Device already blocked');
        assert.strictEqual(conflict.statusCode, 409);
        assert.strictEqual(conflict.code, 'CONFLICT');

        const invariantErr = new InvariantViolationError('Cannot delete gateway router (Invariant 1: Gateway Immunity)');
        assert.strictEqual(invariantErr.statusCode, 400);
        assert.strictEqual(invariantErr.code, 'INVARIANT_VIOLATION');
        assert.ok(invariantErr instanceof AppError);

        const upstream = new UpstreamServiceError('FastAPI failed', 503, 'BRIDGE_UNAVAILABLE');
        assert.strictEqual(upstream.statusCode, 503);
        assert.strictEqual(upstream.code, 'BRIDGE_UNAVAILABLE');

        console.log('  ✓ Hierarchy: All specialized domain subclasses inherit from AppError with correct status codes');
    }

    // 2. License Error Subclasses inherit AppError (ForbiddenError)
    {
        const limitErr = new FeatureLimitError('Quota exceeded');
        assert.strictEqual(limitErr.statusCode, 403);
        assert.strictEqual(limitErr.code, 'FEATURE_LIMIT_EXCEEDED');
        assert.ok(limitErr instanceof ForbiddenError);
        assert.ok(limitErr instanceof AppError);

        const lockedErr = new FeatureLockedError('VIP Arsenal locked');
        assert.strictEqual(lockedErr.statusCode, 403);
        assert.strictEqual(lockedErr.code, 'FEATURE_LOCKED_PRO');
        assert.ok(lockedErr instanceof ForbiddenError);
        assert.ok(lockedErr instanceof AppError);

        console.log('  ✓ License Hierarchy: FeatureLimitError & FeatureLockedError inherit ForbiddenError (403)');
    }

    // 3. respondError Middleware with AppError
    {
        const mockRes = createMockResponse();
        const err = new NotFoundError('Device aa:bb:cc:dd:ee:ff not found');
        respondError(mockRes, err);

        assert.strictEqual(mockRes.getStatusCode(), 404);
        assert.strictEqual(mockRes.getBody().success, false);
        assert.strictEqual(mockRes.getBody().error, 'Device aa:bb:cc:dd:ee:ff not found');
        assert.strictEqual(mockRes.getBody().code, 'NOT_FOUND');

        console.log('  ✓ Middleware: respondError maps AppError directly to statusCode and structured error envelope');
    }

    // 4. Invariant 1 and Invariant 2 Enforcement via respondError
    {
        const mockRes = createMockResponse();
        const invariantErr = new InvariantViolationError('Cannot delete gateway router (Invariant 1: Gateway Immunity)');
        respondError(mockRes, invariantErr);

        assert.strictEqual(mockRes.getStatusCode(), 400);
        assert.strictEqual(mockRes.getBody().success, false);
        assert.strictEqual(mockRes.getBody().error, 'Cannot delete gateway router (Invariant 1: Gateway Immunity)');
        assert.strictEqual(mockRes.getBody().code, 'INVARIANT_VIOLATION');

        console.log('  ✓ Invariant Protection: InvariantViolationError returns HTTP 400 with INVARIANT_VIOLATION code');
    }

    // 5. Sanitization of Non-Operational / Internal Errors (P2 Security)
    {
        const mockRes = createMockResponse();
        const internalCrash = new Error('SQLITE_CORRUPT: disk I/O error at line 4402');
        respondError(mockRes, internalCrash);

        assert.strictEqual(mockRes.getStatusCode(), 500);
        assert.strictEqual(mockRes.getBody().success, false);
        assert.strictEqual(mockRes.getBody().error, 'Terjadi kesalahan internal pada server.');
        assert.strictEqual(mockRes.getBody().code, undefined, 'Internal errors must not leak error code');

        console.log('  ✓ Security: Unhandled internal system crashes are masked to prevent information leakage');
    }

    // 6. Backward Compatibility for Legacy Operational Errors
    {
        const mockRes = createMockResponse();
        const legacyErr = new Error('Device not found in active ARP table');
        respondError(mockRes, legacyErr);

        assert.strictEqual(mockRes.getStatusCode(), 500);
        assert.strictEqual(mockRes.getBody().success, false);
        assert.strictEqual(mockRes.getBody().error, 'Device not found in active ARP table');

        console.log('  ✓ Backward Compatibility: Legacy errors matching operational pattern preserve error messages');
    }
}
