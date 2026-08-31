// beui.dev/components/motion/scroll-animation (Smooth Scroll)
import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
  AnimatePresence,
} from "framer-motion";
import { ArrowUp } from "lucide-react";
import { cn } from "../../lib/utils";

export type ScrollTarget = number | string | HTMLElement;

export type ScrollToOptions = {
  offset?: number;
  immediate?: boolean;
  duration?: number;
};

export type SmoothScrollApi = {
  /** Current scroll offset in px. */
  scrollY: MotionValue<number>;
  /** Scroll position as 0..1 of the scrollable height. */
  progress: MotionValue<number>;
  /** Signed scroll velocity (px/frame); drives velocity-based effects. */
  velocity: MotionValue<number>;
  /** Programmatic smooth scroll. */
  scrollTo: (target: ScrollTarget, options?: ScrollToOptions) => void;
};

const SmoothScrollContext = createContext<SmoothScrollApi | null>(null);

export interface SmoothScrollProps {
  children: ReactNode;
  /** Drive the page (window) when true, or a contained scroll area when false. */
  root?: boolean;
  className?: string;
  showScrollTop?: boolean;
}

type ScrollSource = Window | HTMLElement;

function readMetrics(target: ScrollSource) {
  if (target instanceof Window) {
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    return { y: window.scrollY, max };
  }
  return {
    y: target.scrollTop,
    max: Math.max(0, target.scrollHeight - target.clientHeight),
  };
}

function resolveTop(
  target: ScrollTarget,
  source: ScrollSource,
  offset = 0
): number {
  if (typeof target === "number") return target + offset;
  if (source instanceof Window) {
    const el =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return window.scrollY;
    return el.getBoundingClientRect().top + window.scrollY + offset;
  }
  const el =
    typeof target === "string" ? source.querySelector(target) : target;
  if (!(el instanceof HTMLElement)) return source.scrollTop;
  return el.offsetTop + offset;
}

export function ScrollTopButton({
  className,
  threshold = 0.08,
}: {
  className?: string;
  threshold?: number;
}) {
  const { scrollTo, progress } = useSmoothScroll();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return progress.on("change", (latest) => {
      setVisible(latest > threshold);
    });
  }, [progress, threshold]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 8 }}
          transition={{ duration: 0.2 }}
          onClick={() => scrollTo(0)}
          className={cn(
            "sticky bottom-3.5 ml-auto mr-3 z-30 grid size-8 place-items-center rounded-full border border-white/[0.12] bg-[#121316]/90 text-zinc-300 hover:text-white shadow-xl backdrop-blur transition-colors hover:bg-white/[0.1] active:scale-95",
            className
          )}
          aria-label="Scroll to top"
          title="Kembali ke atas"
        >
          <ArrowUp className="size-3.5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export function SmoothScroll({
  children,
  root = false,
  className,
  showScrollTop = true,
}: SmoothScrollProps) {
  const reduce = useReducedMotion();
  const scrollY = useMotionValue(0);
  const progress = useMotionValue(0);
  const velocity = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const nativeSource = useCallback(
    (): ScrollSource | null => (root ? window : containerRef.current),
    [root]
  );

  // Sync scroll metrics
  useEffect(() => {
    const target = nativeSource();
    if (!target) return;

    let lastY = readMetrics(target).y;
    let lastT = performance.now();

    const onScroll = () => {
      const { y, max } = readMetrics(target);
      const now = performance.now();
      const dt = now - lastT || 16;
      scrollY.set(y);
      progress.set(max > 0 ? y / max : 0);
      velocity.set(((y - lastY) / dt) * 16);
      lastY = y;
      lastT = now;
    };

    onScroll();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [nativeSource, scrollY, progress, velocity]);

  const scrollTo = useCallback(
    (target: ScrollTarget, options?: ScrollToOptions) => {
      const source = nativeSource();
      if (!source) return;

      const top = resolveTop(target, source, options?.offset);

      if (reduce || options?.immediate) {
        if (source instanceof Window) {
          window.scrollTo({ top, behavior: "auto" });
        } else {
          source.scrollTop = top;
        }
        return;
      }

      // Smooth programmatic scroll
      if (source instanceof Window) {
        window.scrollTo({ top, behavior: "smooth" });
      } else {
        source.scrollTo({ top, behavior: "smooth" });
      }
    },
    [reduce, nativeSource]
  );

  const api = useMemo<SmoothScrollApi>(
    () => ({ scrollY, progress, velocity, scrollTo }),
    [scrollY, progress, velocity, scrollTo]
  );

  return (
    <SmoothScrollContext.Provider value={api}>
      <div
        ref={containerRef}
        className={cn(
          "scroll-smooth scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent relative",
          className
        )}
      >
        {children}
        {showScrollTop && <ScrollTopButton />}
      </div>
    </SmoothScrollContext.Provider>
  );
}

export function useSmoothScroll(): SmoothScrollApi {
  const ctx = useContext(SmoothScrollContext);
  const scrollY = useMotionValue(0);
  const progress = useMotionValue(0);
  const velocity = useMotionValue(0);

  useEffect(() => {
    if (ctx !== null) return;
    const target = window;
    let lastY = window.scrollY;
    let lastT = performance.now();

    const onScroll = () => {
      const { y, max } = readMetrics(target);
      const now = performance.now();
      const dt = now - lastT || 16;
      scrollY.set(y);
      progress.set(max > 0 ? y / max : 0);
      velocity.set(((y - lastY) / dt) * 16);
      lastY = y;
      lastT = now;
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ctx, scrollY, progress, velocity]);

  const scrollTo = useCallback((target: ScrollTarget, options?: ScrollToOptions) => {
    window.scrollTo({
      top: resolveTop(target, window, options?.offset),
      behavior: options?.immediate ? "auto" : "smooth",
    });
  }, []);

  const fallback = useMemo<SmoothScrollApi>(
    () => ({ scrollY, progress, velocity, scrollTo }),
    [scrollY, progress, velocity, scrollTo]
  );

  return ctx ?? fallback;
}
