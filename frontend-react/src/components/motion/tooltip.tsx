// beui.dev/components/motion/tooltip
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/utils";

type Side = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  delay?: number;
  className?: string;
}

const GAP = 8;

export function Tooltip({
  content,
  children,
  side = "top",
  delay = 120,
  className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const positions: Record<Side, { top: number; left: number }> = {
      top: { top: rect.top - GAP, left: cx },
      bottom: { top: rect.bottom + GAP, left: cx },
      left: { top: cy, left: rect.left - GAP },
      right: { top: cy, left: rect.right + GAP },
    };

    setCoords(positions[side]);
  }, [side]);

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePosition]);

  if (!isValidElement(children)) return children;

  const anchorTransform: Record<Side, string> = {
    top: "translate(-50%, -100%)",
    bottom: "translate(-50%, 0)",
    left: "translate(-100%, -50%)",
    right: "translate(0, -50%)",
  };

  const transformOrigin: Record<Side, string> = {
    top: "center bottom",
    bottom: "center top",
    left: "right center",
    right: "left center",
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-flex"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerEnter={handleMouseEnter}
        onPointerLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
      >
        {children}
      </span>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <span
                aria-hidden
                className="pointer-events-none fixed z-[9999]"
                style={{
                  top: coords.top,
                  left: coords.left,
                  transform: anchorTransform[side],
                }}
              >
                <motion.span
                  role="tooltip"
                  initial={{
                    opacity: 0,
                    scale: 0.9,
                    filter: "blur(5px)",
                    y: side === "top" ? 6 : side === "bottom" ? -6 : 0,
                    x: side === "left" ? 6 : side === "right" ? -6 : 0,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    filter: "blur(0px)",
                    y: 0,
                    x: 0,
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.93,
                    filter: "blur(3px)",
                    y: side === "top" ? 4 : side === "bottom" ? -4 : 0,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 420,
                    damping: 30,
                    mass: 0.7,
                  }}
                  style={{ transformOrigin: transformOrigin[side] }}
                  className={cn(
                    "block whitespace-nowrap rounded-lg border border-white/[0.12] bg-[#121316]/95 backdrop-blur-md px-2.5 py-1 text-[11px] font-mono font-medium text-white shadow-2xl",
                    className
                  )}
                >
                  {content}
                </motion.span>
              </span>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
