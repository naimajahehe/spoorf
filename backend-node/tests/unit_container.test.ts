import assert from 'assert';
import { createContainer, ServiceContainer } from '../src/container';
import { createRouter } from '../src/api/routes';
import { IDatabaseService, IPythonBridge, ILicenseManager, IDeviceManager, ITrafficService, IGamingService } from '../src/interfaces';

export async function runContainerTests() {
    console.log('\n--- [Node] Testing ServiceContainer (IoC & Dependency Injection) ---');

    // Test 1: Default container instantiates all core services
    {
        const container = createContainer();
        assert.ok(container instanceof ServiceContainer, 'Container should be an instance of ServiceContainer');
        assert.ok(container.databaseService, 'databaseService must be registered');
        assert.ok(container.pythonBridge, 'pythonBridge must be registered');
        assert.ok(container.licenseManager, 'licenseManager must be registered');
        assert.ok(container.deviceManager, 'deviceManager must be registered');
        assert.ok(container.trafficService, 'trafficService must be registered');
        assert.ok(container.gamingService, 'gamingService must be registered');
        console.log('  ✓ Default instantiation: All 6 core services registered and resolved in container');
    }

    // Test 2: Dependency Injection Overrides allows 100% isolated mocking
    {
        let mockDbInitCalled = false;
        let mockLicenseInitCalled = false;
        let mockDeviceInitCalled = false;
        let mockPythonStopCalled = false;
        let mockDbCloseCalled = false;

        const mockDb: Partial<IDatabaseService> = {
            init: async () => { mockDbInitCalled = true; },
            close: async () => { mockDbCloseCalled = true; }
        };

        const mockBridge: Partial<IPythonBridge> = {
            start: async () => {},
            stop: () => { mockPythonStopCalled = true; }
        };

        const mockLicense: Partial<ILicenseManager> = {
            init: async () => { mockLicenseInitCalled = true; },
            getStatus: () => ({
                tier: 'pro',
                max_cuts: 999,
                can_throttle: true,
                can_gateway: true,
                can_autoreblock: true,
                can_arsenal: true,
                cloud_sync: true,
                expires_at: undefined,
                grace_period_until: undefined,
                email: 'mock@pro.lan',
                name: 'Mock Pro'
            } as any)
        };

        const mockDevice: Partial<IDeviceManager> = {
            init: async () => { mockDeviceInitCalled = true; },
            getDevices: () => []
        };

        const container = createContainer({
            databaseService: mockDb as IDatabaseService,
            pythonBridge: mockBridge as IPythonBridge,
            licenseManager: mockLicense as ILicenseManager,
            deviceManager: mockDevice as IDeviceManager
        });

        assert.strictEqual(container.databaseService, mockDb, 'databaseService must resolve to mock');
        assert.strictEqual(container.pythonBridge, mockBridge, 'pythonBridge must resolve to mock');
        assert.strictEqual(container.licenseManager, mockLicense, 'licenseManager must resolve to mock');
        assert.strictEqual(container.deviceManager, mockDevice, 'deviceManager must resolve to mock');

        // Test container.init()
        await container.init();
        assert.strictEqual(mockDbInitCalled, true, 'mockDb.init() must be invoked during container.init()');
        assert.strictEqual(mockLicenseInitCalled, true, 'mockLicense.init() must be invoked during container.init()');
        assert.strictEqual(mockDeviceInitCalled, true, 'mockDevice.init() must be invoked during container.init()');

        // Test container.shutdown()
        await container.shutdown();
        assert.strictEqual(mockPythonStopCalled, true, 'mockBridge.stop() must be invoked during container.shutdown()');
        assert.strictEqual(mockDbCloseCalled, true, 'mockDb.close() must be invoked during container.shutdown()');

        console.log('  ✓ Dependency Injection Overrides: Mock services cleanly injected, initialized, and shut down');
    }

    // Test 3: Router initialization with container
    {
        const mockDevice: Partial<IDeviceManager> = {
            getDevices: () => [],
            scopeForDisplay: (d) => d,
            findGateway: () => undefined,
            getStatus: async () => ({ status: 'ok' })
        };

        const mockLicense: Partial<ILicenseManager> = {
            getStatus: () => ({ tier: 'free' } as any)
        };

        const container = createContainer({
            deviceManager: mockDevice as IDeviceManager,
            licenseManager: mockLicense as ILicenseManager
        });

        const router = createRouter(container);
        assert.ok(router, 'Router must be created from container');
        assert.ok((router as any).stack.length > 0, 'Routes must be registered into router');

        // Verify that /api/devices route exists
        const devicesRoute = (router as any).stack.find((layer: any) => layer.route?.path === '/api/devices');
        assert.ok(devicesRoute, '/api/devices route must be present in router created via container');

        console.log('  ✓ Composition Root Integration: createRouter(container) successfully wires routes');
    }
}
