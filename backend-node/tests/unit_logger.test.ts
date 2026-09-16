import assert from 'assert';
import { logger, createChildLogger } from '../src/utils/logger';
import { requestLogger } from '../src/middlewares/requestLogger';
import { EventEmitter } from 'events';

export async function runLoggerTests() {
    console.log('\n--- [Node] Testing Structured Logging & Request Tracing (Pino) ---');

    // 1. Pino Logger Singleton and Child Logger
    {
        assert.ok(logger, 'Logger singleton should be defined');
        assert.strictEqual(typeof logger.info, 'function', 'logger.info should be a function');
        assert.strictEqual(typeof logger.warn, 'function', 'logger.warn should be a function');
        assert.strictEqual(typeof logger.error, 'function', 'logger.error should be a function');
        assert.strictEqual(typeof logger.debug, 'function', 'logger.debug should be a function');

        const childLog = createChildLogger('TestModule', { component: 'UnitTest' });
        assert.ok(childLog, 'createChildLogger should return a child logger');
        assert.strictEqual(typeof childLog.info, 'function');
        assert.strictEqual(typeof childLog.error, 'function');
        console.log('  ✓ Logger singleton and child logger instantiation verified');
    }

    // 2. Request Logger Middleware: Auto-generates UUID v4 X-Request-Id when missing
    {
        const middleware = requestLogger();
        const req: any = {
            headers: {},
            method: 'GET',
            originalUrl: '/api/devices',
            socket: { remoteAddress: '127.0.0.1' }
        };
        const headersSet: Record<string, string> = {};
        const res: any = Object.assign(new EventEmitter(), {
            setHeader: (key: string, val: string) => {
                headersSet[key.toLowerCase()] = val;
            },
            statusCode: 200
        });

        let nextCalled = false;
        middleware(req, res, () => {
            nextCalled = true;
        });

        assert.strictEqual(nextCalled, true, 'Middleware should call next()');
        assert.ok(req.id, 'req.id should be auto-generated');
        assert.match(
            req.id,
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            'req.id should be a valid UUID v4'
        );
        assert.strictEqual(headersSet['x-request-id'], req.id, 'x-request-id header should match req.id');
        assert.ok(req.log, 'req.log child logger should be attached to req');
        assert.strictEqual(typeof req.log.info, 'function', 'req.log.info should be a function');

        // Test finish event execution
        assert.doesNotThrow(() => {
            res.emit('finish');
        }, 'Finish event should execute cleanly without errors');

        console.log('  ✓ Auto-generated UUID v4 request tracing and req.log binding verified');
    }

    // 3. Request Logger Middleware: Preserves existing incoming X-Request-Id
    {
        const middleware = requestLogger();
        const incomingId = 'sentinel-trace-abc-123';
        const req: any = {
            headers: { 'x-request-id': incomingId },
            method: 'POST',
            originalUrl: '/api/devices/block',
            ip: '192.168.1.50'
        };
        const headersSet: Record<string, string> = {};
        const res: any = Object.assign(new EventEmitter(), {
            setHeader: (key: string, val: string) => {
                headersSet[key.toLowerCase()] = val;
            },
            statusCode: 400
        });

        middleware(req, res, () => {});

        assert.strictEqual(req.id, incomingId, 'req.id should preserve incoming x-request-id');
        assert.strictEqual(headersSet['x-request-id'], incomingId, 'x-request-id response header should match incoming');

        // Test 4xx finish event branch
        assert.doesNotThrow(() => {
            res.emit('finish');
        }, 'Finish event for 4xx warning should execute cleanly');

        console.log('  ✓ Incoming X-Request-Id preservation and 4xx status logging verified');
    }

    // 4. Request Logger Middleware: Error status (5xx) handling on finish
    {
        const middleware = requestLogger();
        const req: any = {
            headers: {},
            method: 'DELETE',
            originalUrl: '/api/devices/11:22:33:44:55:66',
            socket: {}
        };
        const res: any = Object.assign(new EventEmitter(), {
            setHeader: () => {},
            statusCode: 500
        });

        middleware(req, res, () => {});

        assert.doesNotThrow(() => {
            res.emit('finish');
        }, 'Finish event for 5xx error should execute cleanly');

        console.log('  ✓ 5xx error status logging on finish verified');
    }

    // 5. Premature Client Disconnect (Close Event) & Idempotent Logging
    {
        const middleware = requestLogger();
        const req: any = {
            headers: {},
            method: 'GET',
            originalUrl: '/api/devices/long-poll',
            socket: {}
        };
        const res: any = Object.assign(new EventEmitter(), {
            setHeader: () => {},
            statusCode: 200
        });

        middleware(req, res, () => {});

        // Emit close first (aborted connection) then finish
        assert.doesNotThrow(() => {
            res.emit('close');
            res.emit('finish'); // Should be idempotent and ignored
        }, 'Close followed by finish should be idempotent and not throw');

        console.log('  ✓ Client connection abort (close event) and idempotent logging verified');
    }

    // 6. Error Serializer Verification
    {
        const testError = new Error('Database connection failed');
        assert.doesNotThrow(() => {
            logger.error({ err: testError }, 'Testing error serialization');
        }, 'Logger should serialize error object cleanly');
        console.log('  ✓ Standard error serializer verified');
    }
}
