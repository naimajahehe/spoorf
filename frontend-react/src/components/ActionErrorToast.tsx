import type { FC } from 'react';
import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface Props {
    message: string;
    title?: string;
    onDismiss: () => void;
}

export const ActionErrorToast: FC<Props> = ({
    message,
    title = 'Gagal Memproses Aksi',
    onDismiss
}) => {
    // Auto dismiss after 4.5 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss();
        }, 4500);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#14151a] border border-rose-500/25 shadow-[0_8px_20px_rgba(0,0,0,0.7)] backdrop-blur-xl text-xs select-none w-full">
            <div className="flex items-start gap-2.5 min-w-0">
                <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-rose-300 text-[11px] leading-tight">
                        {title}
                    </span>
                    <span className="text-[11px] text-zinc-300 leading-relaxed mt-0.5 break-words">
                        {message}
                    </span>
                </div>
            </div>
            <button
                type="button"
                onClick={onDismiss}
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 ml-1 outline-none cursor-pointer"
                title="Tutup Notifikasi"
                aria-label="Tutup"
            >
                <X size={12} />
            </button>
        </div>
    );
};
