import assert from 'assert';
import { respondError } from '../src/middlewares/errorHandler';

/**
 * respondError is the single API error-responder. If a handler already began
 * sending a response and then threw, calling res.status().json() again crashes
 * the process with ERR_HTTP_HEADERS_SENT. respondError must detect res.headersSent
 * and skip the send (logging still happens).
 */

function makeRes(headersSent: boolean): any {
    const res: any = { headersSent, statusCode: 200, body: undefined, _jsonCalls: 0, _statusCalls: 0 };
    res.status = (code: number) => { res._statusCalls++; res.statusCode = code; return res; };
    res.json = (payload: any) => { res._jsonCalls++; res.body = payload; return res; };
    res.getHeader = (_name: string) => undefined;
    return res;
}

export async function runErrorHandlerTests() {
    console.log('\n--- [Node] Testing respondError headers-sent safety ---');

    // 1. Headers already sent: must NOT attempt to send again (no ERR_HTTP_HEADERS_SENT).
    {
        const res = makeRes(true);
        assert.doesNotThrow(
            () => respondError(res, new Error('boom')),
            'respondError must not throw when headers were already sent'
        );
        assert.strictEqual(res._jsonCalls, 0, 'must not call res.json when headers already sent');
        console.log('  ✓ Skips response send when headers already sent (no double-send)');
    }

    // 2. Fresh response: still sends the sanitized error envelope.
    {
        const res = makeRes(false);
        respondError(res, new Error('device not found'));
        assert.strictEqual(res._jsonCalls, 1, 'must send error envelope when headers not yet sent');
        assert.strictEqual(res.body.success, false);
        console.log('  ✓ Sends sanitized error envelope on a fresh response');
    }
}
