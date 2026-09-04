import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outputDir = mkdtempSync(join(tmpdir(), 'spoorf-dhcp-profiling-'));

try {
    execFileSync(
        process.execPath,
        [
            './node_modules/typescript/bin/tsc',
            '--target', 'ES2020',
            '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext',
            '--outDir', outputDir,
            'src/lib/dhcpProfiling.ts'
        ],
        { stdio: 'inherit' }
    );

    const {
        calculateDhcpCoverage,
        hasAnyProfileEvidence,
        hasDhcpEvidence
    } = await import(
        `${pathToFileURL(join(outputDir, 'dhcpProfiling.js')).href}?${Date.now()}`
    );

    assert.equal(hasDhcpEvidence({ hostname: 'Galaxy-A52' }), false);
    assert.equal(hasAnyProfileEvidence({ hostname: 'Galaxy-A52', ip: '192.168.1.20' }), true);
    assert.equal(hasDhcpEvidence({ dhcp_client_id: '01:aa:bb' }), true);
    assert.equal(hasDhcpEvidence({ dhcp_fqdn: 'phone.local' }), true);

    const coverage = calculateDhcpCoverage([
        {
            mac: '00:00:00:00:00:01',
            ip: '192.168.1.1',
            is_gateway: true,
            is_online: true,
            dhcp_fingerprint: 'Router'
        },
        {
            mac: '00:00:00:00:00:02',
            ip: '192.168.1.10',
            is_self: true,
            is_online: true,
            dhcp_fingerprint: 'Synthetic Controller'
        },
        {
            mac: 'AA:BB:CC:DD:EE:01',
            ip: '192.168.1.20',
            hostname: 'Galaxy-A52',
            is_online: true
        },
        {
            mac: 'aa:bb:cc:dd:ee:01',
            ip: '192.168.1.99',
            hostname: 'Galaxy-A52',
            is_online: true
        },
        {
            mac: 'aa:bb:cc:dd:ee:02',
            ip: '192.168.1.21',
            hostname: 'Unknown Device',
            is_online: true,
            dhcp_vendor_class: 'android-dhcp-14'
        },
        {
            mac: 'aa:bb:cc:dd:ee:03',
            ip: '192.168.1.22',
            is_online: false,
            dhcp_fingerprint: 'Microsoft Windows Signature'
        }
    ]);

    assert.deepEqual(coverage, {
        eligible: 2,
        dhcpProfiled: 1,
        anyProfiled: 2,
        dhcpPercentage: 50,
        discoveryPercentage: 100
    });
    assert.deepEqual(calculateDhcpCoverage([]), {
        eligible: 0,
        dhcpProfiled: 0,
        anyProfiled: 0,
        dhcpPercentage: null,
        discoveryPercentage: null
    });

    console.log('DHCP profiling metric assertions passed');
} finally {
    rmSync(outputDir, { recursive: true, force: true });
}
