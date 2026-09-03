type ShutdownDependencies = {
    pythonBridge: {
        stopAll(): Promise<void>;
        stop(): void;
    };
    databaseService: {
        close(): Promise<void>;
    };
    server: {
        listening: boolean;
        close(callback: () => void): unknown;
    };
    exit?: (code: number) => void;
    logger?: {
        log(message: string): void;
        warn(message: string, error?: unknown): void;
    };
};

type SignalTarget = {
    once(signal: 'SIGINT' | 'SIGTERM', handler: () => Promise<void>): unknown;
};

export function registerGracefulShutdown(
    dependencies: ShutdownDependencies,
    signalTarget: SignalTarget = process
): () => Promise<void> {
    const {
        pythonBridge,
        databaseService,
        server,
        exit = process.exit,
        logger = console
    } = dependencies;
    let shutdownPromise: Promise<void> | null = null;

    const shutdown = (): Promise<void> => {
        if (shutdownPromise) return shutdownPromise;
        shutdownPromise = (async () => {
            logger.log('\nShutting down...');
            try {
                await pythonBridge.stopAll();
            } catch (error) {
                logger.warn('Python cleanup failed during shutdown:', error);
            }
            try {
                pythonBridge.stop();
            } catch (error) {
                logger.warn('Python bridge stop failed during shutdown:', error);
            }
            try {
                await databaseService.close();
            } catch (error) {
                logger.warn('Database close failed during shutdown:', error);
            }
            try {
                if (server.listening) {
                    await new Promise<void>(resolve => server.close(resolve));
                }
            } catch (error) {
                logger.warn('HTTP server close failed during shutdown:', error);
            }
            logger.log('Server stopped');
            exit(0);
        })();
        return shutdownPromise;
    };

    signalTarget.once('SIGINT', shutdown);
    signalTarget.once('SIGTERM', shutdown);
    return shutdown;
}
