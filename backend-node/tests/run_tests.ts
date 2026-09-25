import { runDatabaseTests } from './unit_database.test';
import { runDeviceManagerTests } from './unit_deviceManager.test';
import { runApiRoutesTests } from './api_routes.test';
import { runPythonBridgeTests } from './unit_pythonBridge.test';
import { runLicenseUnitTests } from './unit_license.test';
import { runSecurityTests } from './unit_security.test';
import { runGamingModeTests } from './unit_gamingMode.test';
import { runNetworkIsolationTests } from './unit_network_isolation.test';
import { runReconciliationTests } from './unit_reconciliation.test';
import { runValidationTests } from './unit_validation.test';
import { runEnvTests } from './unit_env.test';
import { runErrorTests } from './unit_errors.test';
import { runLoggerTests } from './unit_logger.test';
import { runContainerTests } from './unit_container.test';
import { runTrafficServiceTests } from './unit_trafficService.test';
import { runDiscoveryServiceTests } from './unit_discoveryService.test';
import { runReconciliationServiceTests } from './unit_reconciliationService.test';
import { runRepositoriesTests } from './unit_repositories.test';
import { runArsenalGateTests } from './unit_arsenalGate.test';
import { runErrorHandlerTests } from './unit_errorHandler.test';
import { runSessionReaperTests } from './unit_sessionReaper.test';
import { runIdentityReblockTests } from './unit_identityReblock.test';
import { runProfileOverfusionTests } from './unit_profileOverfusion.test';

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
        passed += 21;
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

    try {
        await runNetworkIsolationTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Network Isolation Test Failed:', err);
        failed++;
    }

    try {
        await runReconciliationTests();
        passed += 8;
    } catch (err: any) {
        console.error('❌ Reconciliation Test Failed:', err);
        failed++;
    }

    try {
        await runValidationTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Validation Test Failed:', err);
        failed++;
    }

    try {
        await runEnvTests();
        passed += 3;
    } catch (err: any) {
        console.error('❌ Env Config Test Failed:', err);
        failed++;
    }

    try {
        await runErrorTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Error Hierarchy Test Failed:', err);
        failed++;
    }

    try {
        await runLoggerTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Structured Logging & Tracing Test Failed:', err);
        failed++;
    }

    try {
        await runContainerTests();
        passed += 3;
    } catch (err: any) {
        console.error('❌ ServiceContainer Test Failed:', err);
        failed++;
    }

    try {
        await runTrafficServiceTests();
        passed += 8;
    } catch (err: any) {
        console.error('❌ TrafficService Test Failed:', err);
        failed++;
    }

    try {
        await runDiscoveryServiceTests();
        passed += 5;
    } catch (err: any) {
        console.error('❌ DiscoveryService Test Failed:', err);
        failed++;
    }

    try {
        await runReconciliationServiceTests();
        passed += 5;
    } catch (err: any) {
        console.error('❌ ReconciliationService Test Failed:', err);
        failed++;
    }

    try {
        await runRepositoriesTests();
        passed += 10;
    } catch (err: any) {
        console.error('❌ Repositories Test Failed:', err);
        failed++;
    }

    try {
        await runArsenalGateTests();
        passed += 4;
    } catch (err: any) {
        console.error('❌ Arsenal/Interceptor Gate Test Failed:', err);
        failed++;
    }

    try {
        await runErrorHandlerTests();
        passed += 2;
    } catch (err: any) {
        console.error('❌ ErrorHandler Headers-Sent Test Failed:', err);
        failed++;
    }

    try {
        await runSessionReaperTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Stale Session Reaper Test Failed:', err);
        failed++;
    }

    try {
        await runIdentityReblockTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Identity Re-Block Guard Test Failed:', err);
        failed++;
    }

    try {
        await runProfileOverfusionTests();
        passed += 4;
    } catch (err: any) {
        console.error('❌ Profile Over-Fusion Guard Test Failed:', err);
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
    process.exit(0);
}

main().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
