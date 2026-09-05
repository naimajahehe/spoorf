import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outputDir = join(process.cwd(), '.test-output-profile-coverage');
rmSync(outputDir, { recursive: true, force: true });

try {
    execFileSync(
        process.execPath,
        [
            './node_modules/typescript/bin/tsc',
            '--target', 'ES2020',
            '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext',
            '--outDir', outputDir,
            'src/lib/profileCoverage.ts'
        ],
        { stdio: 'inherit' }
    );

    const {
        isIdentifiedVendor,
        isIdentifiedType,
        isHighConfidenceProfile,
        calculateProfileCoverage
    } = await import(
        `${pathToFileURL(join(outputDir, 'profileCoverage.js')).href}?${Date.now()}`
    );

    // Identified vendor: generic / randomized / unknown labels are NOT identified.
    assert.equal(isIdentifiedVendor({ vendor: 'Generic Device' }), false);
    assert.equal(isIdentifiedVendor({ vendor: 'Private Device (Randomized MAC)' }), false);
    assert.equal(isIdentifiedVendor({ vendor: 'Unknown' }), false);
    assert.equal(isIdentifiedVendor({ vendor: '' }), false);
    assert.equal(isIdentifiedVendor({ vendor: 'Samsung' }), true);

    // Identified category: generic client label is NOT identified.
    assert.equal(isIdentifiedType({ device_type: 'Generic Client Device' }), false);
    assert.equal(isIdentifiedType({ device_type: 'Unknown' }), false);
    assert.equal(isIdentifiedType({ device_type: '' }), false);
    assert.equal(isIdentifiedType({ device_type: 'Smartphone / Tablet' }), true);

    // High-confidence requires a backend 'high' status AND identified vendor + category.
    assert.equal(isHighConfidenceProfile({
        vendor: 'Samsung',
        device_type: 'Smartphone / Tablet',
        profile_status: 'high',
        vendor_confidence: 94,
        type_confidence: 96
    }), true);
    // 'high' status but generic vendor must NOT count as high confidence.
    assert.equal(isHighConfidenceProfile({
        vendor: 'Generic Device',
        device_type: 'Smartphone / Tablet',
        profile_status: 'high'
    }), false);
    // identified vendor+type but not 'high' status must NOT count as high.
    assert.equal(isHighConfidenceProfile({
        vendor: 'Samsung',
        device_type: 'Smartphone / Tablet',
        profile_status: 'medium'
    }), false);

    // Coverage over a unique-MAC sample. Gateway, controller and offline rows are
    // excluded from the visible/eligible denominator; unknown rows stay in it.
    const coverage = calculateProfileCoverage([
        { mac: '00:00:00:00:00:01', ip: '192.168.1.1', is_gateway: true, is_online: true },
        { mac: '00:00:00:00:00:02', ip: '192.168.1.10', is_self: true, is_online: true },
        {
            mac: 'aa:bb:cc:dd:ee:09', ip: '192.168.1.9', is_online: false,
            vendor: 'Samsung', device_type: 'Smartphone / Tablet', profile_status: 'high', hostname: 'Galaxy-Offline'
        },
        {
            mac: 'AA:BB:CC:DD:EE:01', ip: '192.168.1.20', is_online: true,
            vendor: 'Samsung', device_type: 'Smartphone / Tablet', profile_status: 'high',
            vendor_confidence: 94, type_confidence: 96, hostname: 'Galaxy-A07'
        },
        // duplicate MAC (different case + IP) must be de-duplicated, not double-counted.
        {
            mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.99', is_online: true,
            vendor: 'Samsung', device_type: 'Smartphone / Tablet', profile_status: 'high', hostname: 'Galaxy-A07'
        },
        {
            mac: 'aa:bb:cc:dd:ee:02', ip: '192.168.1.21', is_online: true,
            vendor: 'Apple', device_type: 'Generic Client Device', profile_status: 'medium', hostname: 'iPhone'
        },
        {
            mac: 'aa:bb:cc:dd:ee:03', ip: '192.168.1.22', is_online: true,
            vendor: 'Generic Device', device_type: 'Generic Client Device', profile_status: 'unknown'
        }
    ]);

    assert.deepEqual(coverage, {
        visible: 3,
        highConfidence: 1,
        mediumConfidence: 1,
        unknown: 1,
        hostnameCount: 2,
        coveragePercentage: 33
    });

    assert.deepEqual(calculateProfileCoverage([]), {
        visible: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        unknown: 0,
        hostnameCount: 0,
        coveragePercentage: null
    });

    // Source-level safety assertions: the disruptive micro-cut vocabulary and the
    // follow-up re-scan must be gone; the hook must call the passive endpoint.
    const modalSource = readFileSync('src/components/DhcpReconnectModal.tsx', 'utf8');
    const hookSource = readFileSync('src/hooks/useWebSocket.ts', 'utf8');
    assert.equal(modalSource.includes('Micro-Cut'), false, 'no Micro-Cut wording');
    assert.equal(modalSource.includes('Micro-cut'), false, 'no micro-cut wording');
    assert.equal(modalSource.includes('memutus akses'), false, 'no disconnect wording');
    assert.equal(modalSource.includes('Quick Re-Auth'), false, 'no quick re-auth wording');
    assert.equal(modalSource.includes('onTriggerReScan'), false, 'no follow-up re-scan');
    assert.equal(hookSource.includes('/api/network/profile-refresh'), true, 'hook calls passive profile endpoint');

    console.log('Profile coverage metric + safety assertions passed');
} finally {
    rmSync(outputDir, { recursive: true, force: true });
}
