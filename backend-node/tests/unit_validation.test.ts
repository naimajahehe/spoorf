import assert from 'assert';
import {
    SpeedLimitBodySchema,
    SetAliasBodySchema,
    RedirectDeviceBodySchema,
    BlockDeviceParamsSchema
} from '../src/schemas/deviceSchemas';
import {
    StartGatewayBodySchema,
    SinkholeDomainBodySchema
} from '../src/schemas/gatewaySchemas';
import {
    BettercapSynScanBodySchema,
    AddDnsRuleBodySchema
} from '../src/schemas/bettercapSchemas';
import { LeafCertBodySchema } from '../src/schemas/interceptorSchemas';
import { formatZodError } from '../src/middlewares/validation';

export async function runValidationTests() {
    console.log('\n--- [Node] Testing Declarative Zod Validation Schemas ---');

    // 1. Speed Limit Validation Schema
    {
        assert.strictEqual(SpeedLimitBodySchema.safeParse({ limit: 50 }).success, true);
        assert.strictEqual(SpeedLimitBodySchema.safeParse({ limit: 0 }).success, true);
        assert.strictEqual(SpeedLimitBodySchema.safeParse({ limit: 100 }).success, true);

        const resMissing = SpeedLimitBodySchema.safeParse({});
        assert.strictEqual(resMissing.success, false);
        if (!resMissing.success) {
            assert.strictEqual(formatZodError(resMissing.error), 'Numeric speed limit (0-100) is required');
        }

        const resString = SpeedLimitBodySchema.safeParse({ limit: '50' });
        assert.strictEqual(resString.success, false);

        const resNegative = SpeedLimitBodySchema.safeParse({ limit: -1 });
        assert.strictEqual(resNegative.success, false);

        const resOver = SpeedLimitBodySchema.safeParse({ limit: 101 });
        assert.strictEqual(resOver.success, false);

        const resNaN = SpeedLimitBodySchema.safeParse({ limit: NaN });
        assert.strictEqual(resNaN.success, false);

        console.log('  ✓ SpeedLimitBodySchema: Rejects negative, over-range, NaN, and non-numbers');
    }

    // 2. Alias Validation Schema
    {
        assert.strictEqual(SetAliasBodySchema.safeParse({ alias: 'Work Laptop' }).success, true);
        assert.strictEqual(SetAliasBodySchema.safeParse({ alias: '' }).success, true);

        const resMissing = SetAliasBodySchema.safeParse({});
        assert.strictEqual(resMissing.success, false);
        if (!resMissing.success) {
            assert.strictEqual(formatZodError(resMissing.error), 'Valid alias string is required');
        }

        const resNumber = SetAliasBodySchema.safeParse({ alias: 123 });
        assert.strictEqual(resNumber.success, false);

        console.log('  ✓ SetAliasBodySchema: Requires string, allows empty string, rejects missing and numbers');
    }

    // 3. Redirect Device Validation Schema
    {
        assert.strictEqual(RedirectDeviceBodySchema.safeParse({ redirectUrl: 'https://instagram.com' }).success, true);

        const resMissing = RedirectDeviceBodySchema.safeParse({});
        assert.strictEqual(resMissing.success, false);
        if (!resMissing.success) {
            assert.strictEqual(formatZodError(resMissing.error), 'Valid redirectUrl string is required');
        }

        console.log('  ✓ RedirectDeviceBodySchema: Validates redirectUrl presence and string type');
    }

    // 4. Gateway Start Schema
    {
        assert.strictEqual(StartGatewayBodySchema.safeParse({ ip: '192.168.1.50' }).success, true);

        const resMissing = StartGatewayBodySchema.safeParse({});
        assert.strictEqual(resMissing.success, false);
        if (!resMissing.success) {
            assert.strictEqual(formatZodError(resMissing.error), 'Valid IP string is required');
        }

        console.log('  ✓ StartGatewayBodySchema: Enforces required valid IP');
    }

    // 5. Bettercap SYN Scan Schema (Invariant 4: RFC 1918 Scope)
    {
        assert.strictEqual(BettercapSynScanBodySchema.safeParse({ target_ip: '192.168.1.100' }).success, true);
        assert.strictEqual(BettercapSynScanBodySchema.safeParse({ target_ip: '10.0.0.1' }).success, true);
        assert.strictEqual(BettercapSynScanBodySchema.safeParse({ target_ip: '172.16.1.1' }).success, true);

        const resPublic = BettercapSynScanBodySchema.safeParse({ target_ip: '8.8.8.8' });
        assert.strictEqual(resPublic.success, false);
        if (!resPublic.success) {
            assert.strictEqual(formatZodError(resPublic.error), 'Target IP must be an RFC 1918 private address');
        }

        const resMissing = BettercapSynScanBodySchema.safeParse({});
        assert.strictEqual(resMissing.success, false);
        if (!resMissing.success) {
            assert.strictEqual(formatZodError(resMissing.error), 'Target IP is required');
        }

        console.log('  ✓ BettercapSynScanBodySchema: Enforces RFC 1918 private IPv4 scope strictness');
    }

    // 6. Interceptor Leaf Cert Schema
    {
        assert.strictEqual(LeafCertBodySchema.safeParse({ domain: 'api.target.com' }).success, true);

        const resEmpty = LeafCertBodySchema.safeParse({ domain: '   ' });
        assert.strictEqual(resEmpty.success, false);
        if (!resEmpty.success) {
            assert.strictEqual(formatZodError(resEmpty.error), 'Domain parameter is required');
        }

        console.log('  ✓ LeafCertBodySchema: Validates trimmed non-empty domain name');
    }
}
