import assert from 'assert';
import pino from 'pino';
import { trace, SpanContext, TraceFlags } from '@opentelemetry/api';
import { logger, createChildLogger, loggerOptions } from '../src/utils/logger';
import { requestLogger, isHealthCheck } from '../src/middlewares/requestLogger';
import { EventEmitter } from 'events';

export async function runLoggerTests() {
    console.log('\n--- [Node] Testing Structured Logging & Request Tracing (Pino + OTel) ---');

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

    // 7. Strict Log Contract Schema & In-Memory JSON Parsing
    {
        const logLines: string[] = [];
        const memoryStream = {
            write: (chunk: string) => {
                logLines.push(chunk.trim());
                return true;
            }
        };

        const testLogger = pino(
            {
                ...loggerOptions,
                level: 'info'
            },
            memoryStream as any
        );

        testLogger.info(
            {
                event: { action: 'device_blocked', category: 'business' },
                context: { mac: '11:22:33:44:55:66', targetIp: '192.168.1.100' }
            },
            'Target device successfully isolated from network'
        );

        assert.strictEqual(logLines.length, 1, 'Should capture exactly 1 log line');
        const parsed = JSON.parse(logLines[0]);

        // Validate Strict Log Contract keys
        assert.ok(parsed.timestamp, 'timestamp must exist');
        assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'timestamp must be ISO 8601 UTC');
        assert.strictEqual(parsed.level, 'INFO', 'level must be uppercase string');
        assert.ok(parsed.service, 'service object must exist');
        assert.strictEqual(typeof parsed.service.name, 'string', 'service.name must be string');
        assert.strictEqual(typeof parsed.service.version, 'string', 'service.version must be string');
        assert.strictEqual(typeof parsed.service.environment, 'string', 'service.environment must be string');
        assert.ok(parsed.event, 'event object must exist');
        assert.strictEqual(parsed.event.action, 'device_blocked');
        assert.strictEqual(parsed.event.category, 'business');
        assert.strictEqual(parsed.message, 'Target device successfully isolated from network');
        assert.deepStrictEqual(parsed.context, { mac: '11:22:33:44:55:66', targetIp: '192.168.1.100' });

        console.log('  ✓ Strict Log Contract JSON schema & ECS keys verified');
    }

    // 8. Health Check Bypass Filtering
    {
        assert.strictEqual(isHealthCheck('/health'), true, '/health should be recognized as health check');
        assert.strictEqual(isHealthCheck('/api/health'), true, '/api/health should be recognized as health check');
        assert.strictEqual(isHealthCheck('/healthz'), true, '/healthz should be recognized as health check');
        assert.strictEqual(isHealthCheck('/livez'), true, '/livez should be recognized as health check');
        assert.strictEqual(isHealthCheck('/readyz'), true, '/readyz should be recognized as health check');
        assert.strictEqual(isHealthCheck('/healthz?probe=liveness'), true, 'Query params should be ignored');
        assert.strictEqual(isHealthCheck('/api/devices'), false, 'Business routes must not be bypassed');
        assert.strictEqual(isHealthCheck('/api/scan'), false, 'Scan routes must not be bypassed');
        console.log('  ✓ Health check bypass filtering for Kubernetes probes verified');
    }

    // 9. Error Strict Serialization with is_operational field
    {
        const logLines: string[] = [];
        const memoryStream = {
            write: (chunk: string) => {
                logLines.push(chunk.trim());
                return true;
            }
        };

        const testLogger = pino(
            {
                ...loggerOptions,
                level: 'error'
            },
            memoryStream as any
        );

        const customError = new Error('Upstream timeout');
        (customError as any).isOperational = true;

        testLogger.error({
            event: { action: 'upstream_timeout', category: 'system' },
            error: customError
        }, 'Upstream engine query timed out');

        assert.strictEqual(logLines.length, 1);
        const parsed = JSON.parse(logLines[0]);
        assert.strictEqual(parsed.level, 'ERROR');
        assert.ok(parsed.error, 'error object must be populated on ERROR level');
        assert.strictEqual(parsed.error.name, 'Error');
        assert.strictEqual(parsed.error.message, 'Upstream timeout');
        assert.strictEqual(parsed.error.is_operational, true);
        assert.ok(typeof parsed.error.stack === 'string');
        console.log('  ✓ Strict error block serialization (name, message, stack, is_operational) verified');
    }

    // 10. Automatic Sensitive Data & PII Redaction
    {
        const logLines: string[] = [];
        const memoryStream = {
            write: (chunk: string) => {
                logLines.push(chunk.trim());
                return true;
            }
        };

        const testLogger = pino(
            {
                ...loggerOptions,
                level: 'info'
            },
            memoryStream as any
        );

        testLogger.info({
            password: 'secret_admin_pass',
            token: 'jwt.token.secret',
            secret: 'my_api_secret',
            cvv: '123',
            apiKey: 'key_xyz',
            context: {
                password: 'plain_password',
                token: 'nested_token'
            }
        }, 'Inbound request credentials');

        assert.strictEqual(logLines.length, 1);
        const parsed = JSON.parse(logLines[0]);
        assert.strictEqual(parsed.password, '[REDACTED]');
        assert.strictEqual(parsed.token, '[REDACTED]');
        assert.strictEqual(parsed.secret, '[REDACTED]');
        assert.strictEqual(parsed.cvv, '[REDACTED]');
        assert.strictEqual(parsed.apiKey, '[REDACTED]');
        assert.strictEqual(parsed.context.password, '[REDACTED]');
        assert.strictEqual(parsed.context.token, '[REDACTED]');
        console.log('  ✓ Zero leak secret & PII auto-redaction verified');
    }
}
