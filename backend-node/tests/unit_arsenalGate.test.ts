import assert from 'assert';
import { BettercapController } from '../src/controllers/bettercapController';
import { InterceptorController } from '../src/controllers/interceptorController';
import { FeatureLockedError } from '../src/services/licenseManager';

/**
 * N-LIC regression: the VIP Arsenal (Bettercap) credential read and the L7
 * Interceptor's flow read + leaf-cert minting must be license-gated exactly
 * like their mutate/clear siblings. Before the fix, `getCredentials`,
 * `getFlows`, and `generateLeafCert` reached the service for a free-tier
 * caller (reading sniffed plaintext credentials / victim browsing history /
 * minting a forgery cert with no gate).
 */

function makeRes(): any {
    const res: any = { statusCode: 200, body: undefined, headers: {} };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: any) => { res.body = b; return res; };
    res.send = (b: any) => { res.body = b; return res; };
    res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
    return res;
}

function makeLicense(canArsenal: boolean): any {
    return {
        checkCanArsenal: () => canArsenal
            ? { allowed: true }
            : { allowed: false, reason: 'Fitur VIP Arsenal terkunci' }
    };
}

function makeService() {
    const calls: string[] = [];
    return {
        calls,
        getBettercapCredentials: async () => { calls.push('getBettercapCredentials'); return []; },
        getL7Flows: async () => { calls.push('getL7Flows'); return { success: true, flows: [] }; },
        generateLeafCert: async () => { calls.push('generateLeafCert'); return { success: true }; }
    } as any;
}

export async function runArsenalGateTests() {
    console.log('\n--- [Node] Testing VIP Arsenal / Interceptor License Gate (N-LIC) ---');

    // 1. Bettercap getCredentials must be gated for a free-tier caller.
    {
        const svc = makeService();
        const ctrl = new BettercapController(svc, makeLicense(false));
        let threw = false;
        try {
            await ctrl.getCredentials({ query: {} } as any, makeRes());
        } catch (err) {
            threw = err instanceof FeatureLockedError;
        }
        assert.strictEqual(threw, true, 'getCredentials must throw FeatureLockedError for free tier');
        assert.ok(!svc.calls.includes('getBettercapCredentials'), 'must not reach service when gated');
        console.log('  ✓ Bettercap getCredentials gated (403) for free tier');
    }

    // 2. Interceptor generateLeafCert must be gated for a free-tier caller.
    {
        const svc = makeService();
        const ctrl = new (InterceptorController as any)(svc, makeLicense(false));
        let threw = false;
        try {
            await ctrl.generateLeafCert({ body: { domain: 'example.com' } } as any, makeRes());
        } catch (err) {
            threw = err instanceof FeatureLockedError;
        }
        assert.strictEqual(threw, true, 'generateLeafCert must throw FeatureLockedError for free tier');
        assert.ok(!svc.calls.includes('generateLeafCert'), 'must not mint leaf cert when gated');
        console.log('  ✓ Interceptor generateLeafCert gated (403) for free tier');
    }

    // 3. Interceptor getFlows must be gated for a free-tier caller.
    {
        const svc = makeService();
        const ctrl = new (InterceptorController as any)(svc, makeLicense(false));
        let threw = false;
        try {
            await ctrl.getFlows({ query: {} } as any, makeRes());
        } catch (err) {
            threw = err instanceof FeatureLockedError;
        }
        assert.strictEqual(threw, true, 'getFlows must throw FeatureLockedError for free tier');
        assert.ok(!svc.calls.includes('getL7Flows'), 'must not read L7 flows when gated');
        console.log('  ✓ Interceptor getFlows gated (403) for free tier');
    }

    // 4. VIP/arsenal tier: the same handlers proceed to the service.
    {
        const svc = makeService();
        const bctrl = new BettercapController(svc, makeLicense(true));
        await bctrl.getCredentials({ query: {} } as any, makeRes());
        assert.ok(svc.calls.includes('getBettercapCredentials'), 'VIP must reach bettercap credentials');

        const ictrl = new (InterceptorController as any)(svc, makeLicense(true));
        await ictrl.generateLeafCert({ body: { domain: 'example.com' } } as any, makeRes());
        await ictrl.getFlows({ query: {} } as any, makeRes());
        assert.ok(svc.calls.includes('generateLeafCert'), 'VIP must reach leaf-cert minting');
        assert.ok(svc.calls.includes('getL7Flows'), 'VIP must reach L7 flows read');
        console.log('  ✓ VIP tier: arsenal & interceptor sensitive handlers proceed');
    }

    console.log('  ✅ N-LIC arsenal/interceptor gate suite passed');
}
