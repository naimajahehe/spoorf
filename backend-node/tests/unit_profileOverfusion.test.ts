import assert from 'assert';
import { Device } from '../src/types';

/**
 * Live bug (profile over-fusion): the "A55-milik-Hanif" profile falsely absorbed several
 * physically-different Android phones (OPPO-Reno13-F, Infinix-NOTE-50-Pro/40, A26-milik-Nade)
 * and one of them (A26) was actually ARP-cut for 54 monitor ticks.
 *
 * Root cause (proven by stored match_score=60): the DHCP fingerprint ("Android OS Signature
 * (android-dhcp-16)") and vendor class ("android-dhcp-16") are OS-GENERIC signatures shared by
 * ~25 different phones on the network, yet they score +30 and +15. Combined with timing
 * continuity (+15) that reaches 60 — the fusing threshold — with ZERO hostname agreement.
 *
 * Fix: when a scanned device announces a hostname that clearly differs from a profile's
 * PERSONALIZED hostname (and does not match its alias), a match resting only on generic
 * OS-level signals is a false positive -> disqualify (score 0). This must NOT weaken the
 * legitimate case where the hostname MATCHES (generic model tracking) or where a real DUID
 * matches (Tier-1 fast-track, evaluated before this guard).
 */

const GENERIC_FP = 'Android OS Signature (android-dhcp-16)';
const GENERIC_VC = 'android-dhcp-16';

function mkDevice(over: Partial<Device>): Device {
    return {
        ip: '192.168.110.50', mac: 'aa:bb:cc:dd:ee:ff', hostname: '', vendor: 'Android',
        device_type: 'Mobile', os: 'Android', rtt_ms: 9, open_ports: [], services: [],
        is_blocked: false, is_online: true, is_gateway: false, is_randomized_mac: true,
        ...over
    } as Device;
}

export async function runProfileOverfusionTests() {
    console.log('\n--- [Node] Testing profile over-fusion guard (generic-signature false match) ---');
    const { calculateProfileMatchScore } = await import('../src/services/database');

    // The A55 profile: personalized hostname, generic Android fingerprint/vendor, one linked MAC
    // that recently disconnected (drives +15 timing continuity).
    const a55Profile = {
        id: 'prof_a55', alias: 'Target Device', hostname: 'A55-milik-Hanif', is_blocked: true,
        dhcp_fingerprint: GENERIC_FP, dhcp_vendor_class: GENERIC_VC,
        linked_macs: ['56:e9:8d:38:1c:97']
    };
    const a55Linked: any[] = [{
        ip: '', mac: '56:e9:8d:38:1c:97', hostname: 'A55-milik-Hanif', is_blocked: true,
        is_online: false, is_gateway: false, profile_id: 'prof_a55',
        dhcp_fingerprint: GENERIC_FP, dhcp_vendor_class: GENERIC_VC,
        last_seen: new Date(Date.now() - 2 * 60 * 1000).toISOString()
    }];

    // 1. A DIFFERENT phone (generic hostname) must NOT fuse into the personalized A55 profile.
    {
        const oppo = mkDevice({ mac: '0e:a1:09:85:fc:db', hostname: 'OPPO-Reno13-F',
            dhcp_fingerprint: GENERIC_FP, dhcp_vendor_class: GENERIC_VC });
        const r = calculateProfileMatchScore(oppo, a55Profile, a55Linked);
        assert.ok(r.score < 50, `OPPO must not reach candidate/fusing threshold, got ${r.score} (${r.reasons.join(', ')})`);
        assert.ok(r.reasons.some(x => x.includes('hostname_mismatch')),
            `must be disqualified by hostname mismatch, reasons: ${r.reasons.join(', ')}`);
        console.log('  ✓ OPPO-Reno13-F (generic host) does NOT fuse into personalized A55 profile');
    }

    // 2. A DIFFERENT phone with a PERSONALIZED hostname (A26-milik-Nade) must NOT fuse either.
    {
        const a26 = mkDevice({ mac: '1e:a9:97:88:c4:cb', hostname: 'A26-milik-Nade',
            dhcp_fingerprint: GENERIC_FP, dhcp_vendor_class: GENERIC_VC });
        const r = calculateProfileMatchScore(a26, a55Profile, a55Linked);
        assert.ok(r.score < 50, `A26 must not reach candidate/fusing threshold, got ${r.score}`);
        assert.ok(r.reasons.some(x => x.includes('hostname_mismatch')), 'A26 must be disqualified');
        console.log('  ✓ A26-milik-Nade does NOT fuse into A55 profile (was falsely cut 54 ticks)');
    }

    // 3. REGRESSION GUARD: the REAL A55 rotating MAC but keeping its hostname must still match high.
    {
        const a55New = mkDevice({ mac: 'de:ad:be:ef:00:01', hostname: 'A55-milik-Hanif',
            dhcp_fingerprint: GENERIC_FP, dhcp_vendor_class: GENERIC_VC });
        const r = calculateProfileMatchScore(a55New, a55Profile, a55Linked);
        assert.ok(r.score >= 80, `genuine A55 rotation must stay high-confidence, got ${r.score}`);
        assert.ok(!r.reasons.some(x => x.includes('hostname_mismatch')), 'genuine A55 must NOT be disqualified');
        console.log('  ✓ Genuine A55 rotation (same hostname, new MAC) still scores high-confidence');
    }

    // 4. REGRESSION GUARD: a GENERIC hostname that MATCHES the profile (Siti/Budi Galaxy-A14) is
    //    NOT disqualified — the guard only fires on a MISMATCH against a personalized profile.
    {
        const budiProfile = {
            id: 'prof_budi', alias: 'HP Budi', hostname: 'Galaxy-A14', is_blocked: true,
            dhcp_fingerprint: 'Android OS Signature', linked_macs: ['c2:4e:ca:88:04:2d']
        };
        const guest = mkDevice({ mac: 'fa:bb:cc:dd:ee:ff', hostname: 'Galaxy-A14',
            dhcp_fingerprint: 'Android OS Signature' });
        const r = calculateProfileMatchScore(guest, budiProfile, []);
        assert.ok(!r.reasons.some(x => x.includes('hostname_mismatch')),
            'matching generic hostname must NOT be disqualified');
        assert.strictEqual(r.score, 50, `generic model match preserved at 50, got ${r.score}`);
        console.log('  ✓ Matching generic hostname (Galaxy-A14) preserved at score 50 (not disqualified)');
    }

    console.log('  ✅ Profile over-fusion guard suite passed');
}
