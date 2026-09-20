/**
 * Polyfill for Node.js runtimes < 18.19 (e.g. Electron 28 embedded Node 18.18.2).
 * Pino v10 unconditionally calls diagChan.tracingChannel('pino_asJson') which
 * throws "TypeError: diagChan.tracingChannel is not a function" on Node < 18.19.
 */
export function applyDiagnosticsChannelPolyfill(): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const dc = require('diagnostics_channel');
        if (dc && typeof dc.tracingChannel !== 'function') {
            dc.tracingChannel = function (nameOrChannels: any) {
                const channel = typeof dc.channel === 'function' ? dc.channel(String(nameOrChannels)) : {
                    hasSubscribers: false,
                    publish: () => {},
                    subscribe: () => {},
                    unsubscribe: () => {}
                };
                return {
                    name: typeof nameOrChannels === 'string' ? nameOrChannels : '',
                    hasSubscribers: false,
                    start: channel,
                    end: channel,
                    asyncStart: channel,
                    asyncEnd: channel,
                    error: channel,
                    subscribe: () => {},
                    unsubscribe: () => {},
                    traceSync: (fn: any, _context: any, thisArg: any, ...args: any[]) => fn.apply(thisArg, args),
                    tracePromise: (fn: any, _context: any, thisArg: any, ...args: any[]) => fn.apply(thisArg, args),
                    traceCallback: (fn: any, _position: any, _context: any, thisArg: any, ...args: any[]) => fn.apply(thisArg, args)
                };
            };
        }
    } catch {
        // Ignore polyfill error in environments where diagnostics_channel cannot be loaded
    }
}

applyDiagnosticsChannelPolyfill();
