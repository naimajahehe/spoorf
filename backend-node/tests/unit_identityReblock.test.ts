import assert from 'assert';
import { shouldAutoLinkReblock, isDuidExactMatch } from '../src/utils/databaseUtils';

/**
 * Live bug (COOLITA): a device that randomizes its L2 MAC but keeps a stable DHCP
 * client-id (Option 61 = 01:<real-mac>) reappears under a new random MAC and is NOT
 * re-blocked, because the auto-reblock is gated by `!hasOtherOnlineInProfile` — and
 * the device's previous (stale) MAC is still marked online in the same scan.
 *
 * A DUID-exact match (client-id, score 100) is authoritative identity: both MACs
 * "online" means one is stale from the SAME physical device, not two devices, so
 * the online guard must be bypassed for DUID-exact matches only. Weak matches
 * (hostname / fingerprint) must still respect the guard (two online devices could
 * genuinely be different) — no false-positive regression.
 */

export async function runIdentityReblockTests() {
    console.log('\n--- [Node] Testing identity re-block guard bypass for DUID-exact match ---');

    // isDuidExactMatch reads the scoring reasons.
    {
        assert.strictEqual(isDuidExactMatch(['duid_hardware_instant_match (+100)']), true);
        assert.strictEqual(isDuidExactMatch(['personalized_unique_hostname_match (+45)', 'dhcp_prl_signature_match (+30)']), false);
        assert.strictEqual(isDuidExactMatch([]), false);
        console.log('  ✓ isDuidExactMatch detects the DUID instant-match reason');
    }

    // THE FIX: DUID-exact + a stale same-identity MAC still online -> still reblock.
    {
        assert.strictEqual(
            shouldAutoLinkReblock({ isHighConfidence: true, isContinuityFusing: false, hasOtherOnlineInProfile: true, isDuidExact: true }),
            true
        );
        console.log('  ✓ DUID-exact match bypasses the online guard (reincarnation re-blocked)');
    }

    // Regression guard: NON-DUID high-confidence + other online -> still suppressed.
    {
        assert.strictEqual(
            shouldAutoLinkReblock({ isHighConfidence: true, isContinuityFusing: false, hasOtherOnlineInProfile: true, isDuidExact: false }),
            false
        );
        console.log('  ✓ Weak (non-DUID) high-confidence still respects the online guard');
    }

    // Unchanged: high-confidence, no other online -> link.
    {
        assert.strictEqual(
            shouldAutoLinkReblock({ isHighConfidence: true, isContinuityFusing: false, hasOtherOnlineInProfile: false, isDuidExact: false }),
            true
        );
        console.log('  ✓ High-confidence with no other online device links (unchanged)');
    }

    // Unchanged: continuity-fusing, no other online -> link.
    {
        assert.strictEqual(
            shouldAutoLinkReblock({ isHighConfidence: false, isContinuityFusing: true, hasOtherOnlineInProfile: false, isDuidExact: false }),
            true
        );
        console.log('  ✓ Continuity-fusing with no other online device links (unchanged)');
    }

    // Neither high-confidence nor continuity -> never link, even if flagged DUID (defensive).
    {
        assert.strictEqual(
            shouldAutoLinkReblock({ isHighConfidence: false, isContinuityFusing: false, hasOtherOnlineInProfile: false, isDuidExact: true }),
            false
        );
        console.log('  ✓ No confidence -> no link (defensive)');
    }

    console.log('  ✅ Identity re-block guard suite passed');
}
