import { runDatabaseTests } from './unit_database.test';
import { runDeviceManagerTests } from './unit_deviceManager.test';
import { runApiRoutesTests } from './api_routes.test';
import { runPythonBridgeTests } from './unit_pythonBridge.test';
import { runLicenseUnitTests } from './unit_license.test';
import { runSecurityTests } from './unit_security.test';
import { runGamingModeTests } from './unit_gamingMode.test';

async function main() {
    console.log('=====================================================');
    console.log('🚀 RUNNING NETCUT-SENTINEL NODE.JS BACKEND TEST SUITE');
    console.log('📖 Governing Spec: docs/specs/SPEC-007_AUTOMATED_TESTING_SUITE.md');
    console.log('📖 Core Invariants: AGENTS.md');
    console.log('=====================================================');

    const startTime = Date.now();
    let passed = 0;
    let failed = 0;

    try {
        await runDatabaseTests();
        passed += 4;
    } catch (err: any) {
        console.error('❌ Database Test Failed:', err);
        failed++;
    }

    try {
        await runDeviceManagerTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ DeviceManager Test Failed:', err);
        failed++;
    }

    try {
        await runLicenseUnitTests();
        passed += 5;
    } catch (err: any) {
        console.error('❌ License Unit Test Failed:', err);
        failed++;
    }

    try {
        await runApiRoutesTests();
        passed += 4;
    } catch (err: any) {
        console.error('❌ API Routes Test Failed:', err);
        failed++;
    }

    try {
        await runPythonBridgeTests();
        passed += 4;
    } catch (err: any) {
        console.error('❌ PythonBridge Test Failed:', err);
        failed++;
    }

    try {
        await runSecurityTests();
        passed += 4;
    } catch (err: any) {
        console.error('❌ Security Guard Test Failed:', err);
        failed++;
    }

    try {
        await runGamingModeTests();
        passed += 7;
    } catch (err: any) {
        console.error('❌ Gaming Mode Test Failed:', err);
        failed++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n=====================================================');
    console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED | ${elapsed}s`);
    console.log('=====================================================');

    if (failed > 0) {
        process.exit(1);
    }
    console.log('🎉 ALL NODE.JS TESTS PASSED SUCCESSFULLY!');
}

main().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
