import { runSupervisorLogicTests } from './supervisor-logic.test';

async function main() {
    console.log('=====================================================');
    console.log('🚀 RUNNING SPOORF SENTINEL ELECTRON SUPERVISOR TEST SUITE');
    console.log('📖 Core Invariants: AGENTS.md');
    console.log('=====================================================');

    const startTime = Date.now();
    let passed = 0;
    let failed = 0;

    try {
        await runSupervisorLogicTests();
        passed += 6;
    } catch (err: any) {
        console.error('❌ Supervisor Logic Test Failed:', err);
        failed++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n=====================================================');
    console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED | ${elapsed}s`);
    console.log('=====================================================');

    if (failed > 0) {
        process.exit(1);
    }
    console.log('🎉 ALL ELECTRON SUPERVISOR TESTS PASSED SUCCESSFULLY!');
}

main().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
