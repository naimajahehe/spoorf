"use client";
// beui.dev/components/motion/dock

import React, { createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SPRING_LAYOUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

type DockContextValue = {
  size: number;
  pillLayoutId: string;
};

const DockContext = createContext<DockContextValue | null>(null);

export interface DockProps {
  children: ReactNode;
  className?: string;
  /** Size of each item in px. */
  size?: number;
}

export function Dock({ children, size = 32, className }: DockProps) {
  const pillLayoutId = useId();
  const ctx = useMemo<DockContextValue>(
    () => ({ size, pillLayoutId }),
    [size, pillLayoutId],
  );

  return (
    <DockContext.Provider value={ctx}>
      <div
        className={cn(
          "inline-flex h-auto items-center gap-1 rounded-2xl border border-white/[0.1] bg-[#121316]/95 px-2 py-1.5 shadow-2xl backdrop-blur-xl",
          className,
        )}
      >
        {children}
      </div>
    </DockContext.Provider>
  );
}

export interface DockItemProps {
  children: ReactNode;
  className?: string;
  /** When set, the item renders as a <button>. Omit when children carry their own link or button. */
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  "aria-label"?: string;
  title?: string;
}

export function DockItem({
  children,
  className,
  onClick,
  active,
  title,
  ...rest
}: DockItemProps) {
  const dock = useContext(DockContext);
  const reduce = useReducedMotion();
  const size = dock?.size ?? 32;
  const pillLayoutId = dock?.pillLayoutId ?? "dock-pill";

  const pill = active ? (
    <motion.span
      layoutId={pillLayoutId}
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      className="absolute inset-0.5 -z-10 rounded-xl bg-white/[0.08]"
    />
  ) : null;
  const sharedStyle = { width: size, height: size };
  const sharedClass = cn(
    "relative flex shrink-0 items-center justify-center rounded-xl text-zinc-300 transition-colors",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={rest["aria-label"]}
        aria-pressed={active}
        style={sharedStyle}
        className={cn(
          sharedClass,
          "cursor-pointer border-0 bg-transparent p-0 outline-none hover:text-white hover:bg-white/[0.06]",
          "focus-visible:ring-2 focus-visible:ring-emerald-400/50",
        )}
      >
        {pill}
        {children}
      </button>
    );
  }

  // Children carry their own link or button (and its accessible name).
  return (
    <div style={sharedStyle} className={sharedClass} title={title}>
      {pill}
      {children}
    </div>
  );
}

export function DockSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("mx-1 h-5 w-px self-center bg-white/[0.1]", className)}
    />
  );
}
