import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useId
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CommandItem {
    id: string;
    label: string;
    group?: string;
    hint?: string;
    keywords?: string[];
    icon?: any;
    badge?: React.ReactNode;
    onSelect: () => void;
}

export interface CommandPaletteProps {
    items: CommandItem[];
    shortcut?: string;
    placeholder?: string;
    emptyMessage?: string;
    isOpen: boolean;
    onClose: () => void;
}

function fuzzyMatch(needle: string, hay: string): boolean {
    if (!needle) return true;
    needle = needle.toLowerCase();
    hay = hay.toLowerCase();
    let i = 0;
    for (const ch of hay) {
        if (ch === needle[i]) i++;
        if (i === needle.length) return true;
    }
    return false;
}

const PANEL_SPRING = {
    type: "spring",
    stiffness: 520,
    damping: 38,
    mass: 0.5,
} as const;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    items,
    shortcut = "k",
    placeholder = "Ketik perintah, nama host, IP, atau aksi…",
    emptyMessage = "Tidak ada hasil yang cocok.",
    isOpen,
    onClose,
}) => {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [mounted, setMounted] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const uid = useId();

    useEffect(() => {
        setMounted(true);
    }, []);

    // Global keyboard shortcut (Cmd+K / Ctrl+K)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === shortcut.toLowerCase()) {
                e.preventDefault();
                if (isOpen) {
                    onClose();
                }
                return;
            }
            if (e.key === "Escape" && isOpen) {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isOpen, shortcut, onClose]);

    // Lock scroll when open
    useEffect(() => {
        if (!isOpen) return;
        const root = document.documentElement;
        const prevOverflow = root.style.overflow;
        root.style.overflow = "hidden";
        return () => {
            root.style.overflow = prevOverflow;
        };
    }, [isOpen]);

    // Reset query & focus when opened
    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setActiveIndex(0);
            const frame = requestAnimationFrame(() => inputRef.current?.focus());
            return () => cancelAnimationFrame(frame);
        }
    }, [isOpen]);

    // Fuzzy filter items
    const filtered = useMemo(() => {
        if (!query.trim()) return items;
        const q = query.trim();
        return items.filter(it => {
            const haystacks = [it.label, it.group ?? "", it.hint ?? "", ...(it.keywords ?? [])];
            return haystacks.some(h => fuzzyMatch(q, h));
        });
    }, [items, query]);

    // Group items
    const grouped = useMemo(() => {
        const map = new Map<string, CommandItem[]>();
        filtered.forEach(it => {
            const g = it.group ?? "Menu & Aksi";
            const groupItems = map.get(g) ?? [];
            groupItems.push(it);
            map.set(g, groupItems);
        });
        return Array.from(map.entries());
    }, [filtered]);

    // Flattened ordered rows for keyboard navigation
    const rows = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

    // Keep active index in range
    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (rows.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex(prev => (prev + 1) % rows.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex(prev => (prev - 1 + rows.length) % rows.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const selected = rows[activeIndex];
            if (selected) {
                selected.onSelect();
                onClose();
            }
        }
    };

    // Auto-scroll active item into view
    useEffect(() => {
        if (!isOpen) return;
        const el = listRef.current?.querySelector<HTMLButtonElement>(
            `[data-index="${activeIndex}"]`
        );
        el?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, isOpen]);

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Frosted Glass Backdrop */}
                    <motion.div
                        key="palette-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md"
                    />

                    {/* Palette Center Modal Layer */}
                    <div className="fixed inset-x-4 top-[12vh] z-[101] flex items-start justify-center pointer-events-none">
                        <motion.div
                            key="palette-panel"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Command Palette"
                            initial={{ opacity: 0, scale: 0.96, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: -10, transition: { duration: 0.12 } }}
                            transition={PANEL_SPRING}
                            onKeyDown={handleKeyDown}
                            className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0e1014]/98 backdrop-blur-2xl shadow-2xl shadow-black/90 flex flex-col will-change-transform"
                        >
                            {/* Search Input Bar */}
                            <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 bg-white/[0.02]">
                                <Search size={17} className="text-zinc-400 shrink-0" />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={placeholder}
                                    className="h-13 w-full py-3.5 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none font-sans"
                                />
                                <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                    ESC
                                </kbd>
                            </div>

                            {/* Commands and Results List */}
                            <div
                                ref={listRef}
                                role="listbox"
                                className="max-h-[55vh] overflow-y-auto overscroll-contain p-2 space-y-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                            >
                                {rows.length === 0 ? (
                                    <div className="py-12 px-4 text-center space-y-1">
                                        <p className="text-xs text-zinc-400 font-medium">{emptyMessage}</p>
                                        <p className="text-[11px] text-zinc-600">Coba cari dengan nama perangkat, alamat IP, atau nama fitur.</p>
                                    </div>
                                ) : (
                                    grouped.map(([group, list]) => (
                                        <div key={group} className="space-y-1">
                                            <div className="px-3 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500">
                                                {group}
                                            </div>
                                            <div className="space-y-0.5">
                                                {list.map((it) => {
                                                    const idx = rows.indexOf(it);
                                                    const isActive = idx === activeIndex;
                                                    const IconComponent = it.icon;

                                                    return (
                                                        <button
                                                            key={it.id}
                                                            type="button"
                                                            data-index={idx}
                                                            role="option"
                                                            aria-selected={isActive}
                                                            onMouseEnter={() => setActiveIndex(idx)}
                                                            onClick={() => {
                                                                it.onSelect();
                                                                onClose();
                                                            }}
                                                            className={cn(
                                                                "relative isolate flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors outline-none cursor-pointer",
                                                                isActive ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                                                            )}
                                                        >
                                                            {/* Spring animated active background highlight */}
                                                            {isActive && (
                                                                <motion.span
                                                                    layoutId={`${uid}-palette-active`}
                                                                    className="absolute inset-0 z-0 rounded-xl bg-white/[0.07] border border-white/[0.08]"
                                                                    transition={{
                                                                        type: "spring",
                                                                        stiffness: 500,
                                                                        damping: 38,
                                                                    }}
                                                                />
                                                            )}

                                                            {IconComponent && (
                                                                <IconComponent size={16} className={cn("relative z-10 shrink-0 transition-colors", isActive ? "text-emerald-400" : "text-zinc-400")} />
                                                            )}

                                                            <div className="relative z-10 flex-1 min-w-0 flex flex-col">
                                                                <span className="truncate font-medium text-zinc-200">
                                                                    {it.label}
                                                                </span>
                                                            </div>

                                                            {it.badge && (
                                                                <span className="relative z-10 shrink-0">
                                                                    {it.badge}
                                                                </span>
                                                            )}

                                                            {it.hint && (
                                                                <span className="relative z-10 font-mono text-[10px] text-zinc-500 shrink-0">
                                                                    {it.hint}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Footer Navigation Hints */}
                            <div className="px-4 py-2.5 border-t border-white/[0.06] bg-white/[0.01] flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                                <div className="flex items-center gap-3">
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[9px]">↑</kbd>
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[9px]">↓</kbd>
                                        Navigasi
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[9px]">↵</kbd>
                                        Pilih
                                    </span>
                                </div>
                                <span className="text-[10px] text-zinc-600">NetCut Sentinel ⌘K</span>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>,
        document.body
    );
};
