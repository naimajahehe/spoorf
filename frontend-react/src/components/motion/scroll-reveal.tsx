// beui.dev/components/motion/scroll-animation
import { type ReactNode, type RefObject, useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

export interface ScrollRevealProps {
  children: ReactNode;
  /** Slide distance in px before reveal. */
  y?: number;
  /** Enter blur in px (kept <= 10 per motion conventions). */
  blur?: number;
  /** Reveal duration in seconds. */
  duration?: number;
  delay?: number;
  /** Reveal only once (default) or every time it enters view. */
  once?: boolean;
  /** Portion of the element that must be visible to trigger. */
  amount?: "some" | "all" | number;
  /** Scroll root for contained scroll areas. Defaults to the viewport. */
  root?: RefObject<Element | null>;
  className?: string;
}

export function ScrollReveal({
  children,
  y = 16,
  blur = 8,
  duration = 0.6,
  delay = 0,
  once = true,
  amount = 0.15,
  root,
  className,
}: ScrollRevealProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { root, once, amount });

  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, y, filter: `blur(${blur}px)` };
  const shown = reduce
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };

  return (
    <motion.div
      ref={ref}
      initial={hidden}
      animate={inView ? shown : hidden}
      transition={{ duration, ease: EASE_OUT, delay }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

export interface ScrollRevealRowProps {
  children: ReactNode;
  y?: number;
  blur?: number;
  duration?: number;
  delay?: number;
  once?: boolean;
  amount?: "some" | "all" | number;
  root?: RefObject<Element | null>;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
}

export function ScrollRevealRow({
  children,
  y = 14,
  blur = 6,
  duration = 0.45,
  delay = 0,
  once = true,
  amount = 0.1,
  root,
  className,
  onClick,
}: ScrollRevealRowProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLTableRowElement>(null);
  const inView = useInView(ref, { root, once, amount });

  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, y, filter: `blur(${blur}px)` };
  const shown = reduce
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };

  return (
    <motion.tr
      ref={ref}
      initial={hidden}
      animate={inView ? shown : hidden}
      transition={{ duration, ease: EASE_OUT, delay }}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.tr>
  );
}
