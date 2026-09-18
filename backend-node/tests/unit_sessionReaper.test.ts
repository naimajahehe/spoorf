import assert from 'assert';
import { computeStaleSpoofSessions } from '../src/utils/deviceUtils';

/**
 * Live-network bug: spoof (block) sessions are bound to a fixed (victim_ip,
 * victim_mac). When the target rotates MAC / gets a new DHCP IP / leaves, the
 * old session is never reaped — it keeps ARP-cutting a stale IP, which DHCP may
 * have reassigned to an innocent device (collateral), or nobody (zombie).
 * Observed live: 45 of 54 sessions stale (10 collateral, 29+ zombie), which also
 * overloaded the Python engine (bridge timeouts).
 *
 * computeStaleSpoofSessions returns the session ids to stop: any ACTIVE session
 * whose exact (victim_ip, victim_mac) target is not a currently-online device.
 * A session whose target is online at that ip+mac (legit block) is kept.
 */

function sess(entries: Array<{ sid: string; ip: string; mac: string; active?: boolean }>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const e of entries) {
        out[e.sid] = { victim_ip: e.ip, victim_mac: e.mac, active: e.active !== false };
    }
    return out;
}

export async function runSessionReaperTests() {
    console.log('\n--- [Node] Testing stale spoof-session reaper (block follows target / no collateral) ---');

    // 1. Legit session (target online at that ip+mac) is KEPT.
    {
        const sessions = sess([{ sid: 's-legit', ip: '192.168.1.50', mac: 'AA:BB:CC:00:00:01' }]);
        const devices = [{ ip: '192.168.1.50', mac: 'aa:bb:cc:00:00:01', is_online: true }];
        assert.deepStrictEqual(computeStaleSpoofSessions(sessions, devices), []);
        console.log('  ✓ Legit block session (target live at ip+mac) is kept');
    }

    // 2. Collateral: IP now held by a DIFFERENT device -> session reaped.
    {
        const sessions = sess([{ sid: 's-collateral', ip: '192.168.1.60', mac: 'AA:BB:CC:00:00:02' }]);
        const devices = [{ ip: '192.168.1.60', mac: 'de:ad:be:ef:00:99', is_online: true }];
        assert.deepStrictEqual(computeStaleSpoofSessions(sessions, devices), ['s-collateral']);
        console.log('  ✓ Collateral session (IP reassigned to another device) is reaped');
    }

    // 3. Zombie: no online device at that IP at all -> session reaped.
    {
        const sessions = sess([{ sid: 's-zombie', ip: '192.168.1.70', mac: 'AA:BB:CC:00:00:03' }]);
        const devices = [{ ip: '192.168.1.99', mac: 'aa:bb:cc:00:00:03', is_online: true }];
        assert.deepStrictEqual(computeStaleSpoofSessions(sessions, devices), ['s-zombie']);
        console.log('  ✓ Zombie session (no live occupant / target moved IP) is reaped');
    }

    // 4. Inactive session is never reaped by this pass (lifecycle handled elsewhere).
    {
        const sessions = sess([{ sid: 's-inactive', ip: '192.168.1.80', mac: 'AA:BB:CC:00:00:04', active: false }]);
        const devices: any[] = [];
        assert.deepStrictEqual(computeStaleSpoofSessions(sessions, devices), []);
        console.log('  ✓ Inactive session is not reaped');
    }

    // 5. Offline device at matching ip+mac -> still reaped (block not enforceable on an offline target).
    {
        const sessions = sess([{ sid: 's-offline', ip: '192.168.1.90', mac: 'AA:BB:CC:00:00:05' }]);
        const devices = [{ ip: '192.168.1.90', mac: 'aa:bb:cc:00:00:05', is_online: false }];
        assert.deepStrictEqual(computeStaleSpoofSessions(sessions, devices), ['s-offline']);
        console.log('  ✓ Session whose target is offline is reaped');
    }

    // 6. Mixed set: only the stale ones are returned, order preserved.
    {
        const sessions = sess([
            { sid: 's1-legit', ip: '10.0.0.1', mac: '11:11:11:11:11:11' },
            { sid: 's2-zombie', ip: '10.0.0.2', mac: '22:22:22:22:22:22' },
            { sid: 's3-legit', ip: '10.0.0.3', mac: '33:33:33:33:33:33' },
            { sid: 's4-collateral', ip: '10.0.0.4', mac: '44:44:44:44:44:44' }
        ]);
        const devices = [
            { ip: '10.0.0.1', mac: '11:11:11:11:11:11', is_online: true },
            { ip: '10.0.0.3', mac: '33:33:33:33:33:33', is_online: true },
            { ip: '10.0.0.4', mac: '99:99:99:99:99:99', is_online: true }
        ];
        assert.deepStrictEqual(computeStaleSpoofSessions(sessions, devices), ['s2-zombie', 's4-collateral']);
        console.log('  ✓ Mixed set: reaps only stale sessions, keeps legit');
    }

    console.log('  ✅ Stale session reaper suite passed');
}
