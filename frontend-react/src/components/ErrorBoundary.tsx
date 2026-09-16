import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check, Terminal, ShieldAlert } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallbackTitle?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    copied: boolean;
    showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
        copied: false,
        showDetails: false
    };

    public static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        console.error('🚨 [Sentinel ErrorBoundary] Uncaught rendering exception:', error, errorInfo);
    }

    private handleReload = (): void => {
        if (typeof window !== 'undefined') {
            window.location.reload();
        }
    };

    private handleResetState = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
            copied: false,
            showDetails: false
        });
    };

    private handleCopyDetails = (): void => {
        const { error, errorInfo } = this.state;
        const diagnosticText = [
            `--- SENTINEL INTERFACE ERROR REPORT ---`,
            `Time: ${new Date().toISOString()}`,
            `Error: ${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`,
            `Stack:\n${error?.stack || 'No stack trace'}`,
            `Component Stack:\n${errorInfo?.componentStack || 'No component stack'}`
        ].join('\n\n');

        navigator.clipboard.writeText(diagnosticText);
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2000);
    };

    public render(): ReactNode {
        if (this.state.hasError) {
            const { error, errorInfo, copied, showDetails } = this.state;
            const title = this.props.fallbackTitle || 'Gangguan Antarmuka Sentinel Terdeteksi';

            return (
                <div
                    data-testid="error-boundary-fallback"
                    className="min-h-screen w-full bg-[#090a0c] text-zinc-200 flex items-center justify-center p-6 font-sans select-none"
                >
                    <div className="relative w-full max-w-xl bg-[#0e1015] border border-rose-500/30 rounded-2xl shadow-[0_0_50px_rgba(244,63,94,0.15)] overflow-hidden flex flex-col">
                        {/* Top Accent Warning Bar */}
                        <div className="h-1 w-full bg-gradient-to-r from-rose-500 via-amber-500 to-rose-600" />

                        <div className="p-6 flex flex-col gap-5">
                            {/* Header Icon & Title */}
                            <div className="flex items-start gap-4">
                                <div className="size-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 shadow-inner">
                                    <ShieldAlert size={26} />
                                </div>
                                <div className="flex flex-col gap-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-base font-bold text-white tracking-tight">
                                            {title}
                                        </h2>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                            UI Fault Caught
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        Komponen visual mengalami kesalahan saat me-render data. Engine proteksi Sentinel dan jaringan di latar belakang tetap berjalan normal.
                                    </p>
                                </div>
                            </div>

                            {/* Short Error Message Box */}
                            <div className="rounded-lg bg-black/50 border border-white/[0.06] p-3 flex items-start gap-2.5 text-xs font-mono text-rose-300">
                                <AlertTriangle size={15} className="shrink-0 text-rose-400 mt-0.5" />
                                <span className="break-all">
                                    {error?.name || 'Error'}: {error?.message || 'Terjadi kesalahan rendering tak terduga.'}
                                </span>
                            </div>

                            {/* Technical Details Toggle */}
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    onClick={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
                                    className="text-[11px] text-zinc-500 hover:text-zinc-300 font-mono flex items-center gap-1.5 transition-colors self-start cursor-pointer outline-none"
                                >
                                    <Terminal size={12} />
                                    <span>{showDetails ? 'Sembunyikan stack trace teknis' : 'Tampilkan stack trace teknis'}</span>
                                </button>

                                {showDetails && (
                                    <div className="max-h-48 overflow-y-auto rounded-lg bg-black/70 border border-white/[0.08] p-3 text-[10px] font-mono text-zinc-400 select-text">
                                        <div className="text-rose-400 font-semibold mb-1">Stack Trace:</div>
                                        <pre className="whitespace-pre-wrap break-all">{error?.stack || 'No stack trace available.'}</pre>
                                        {errorInfo?.componentStack && (
                                            <>
                                                <div className="text-amber-400 font-semibold mt-3 mb-1">Component Hierarchy:</div>
                                                <pre className="whitespace-pre-wrap break-all">{errorInfo.componentStack}</pre>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Actions Bar */}
                            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3 flex-wrap">
                                <button
                                    type="button"
                                    onClick={this.handleCopyDetails}
                                    className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer outline-none"
                                >
                                    {copied ? (
                                        <>
                                            <Check size={13} className="text-emerald-400" />
                                            <span className="text-emerald-400">Tersalin ke Clipboard</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy size={13} />
                                            <span>Salin Diagnostik</span>
                                        </>
                                    )}
                                </button>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={this.handleResetState}
                                        className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white text-xs font-medium transition-colors cursor-pointer outline-none"
                                    >
                                        Coba Pulihkan
                                    </button>
                                    <button
                                        type="button"
                                        onClick={this.handleReload}
                                        className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer outline-none shadow-sm shadow-rose-600/30"
                                    >
                                        <RefreshCw size={13} />
                                        <span>Muat Ulang Aplikasi</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
