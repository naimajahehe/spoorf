// beui.dev/components/motion/pull-to-refresh
import {
  AnimatePresence,
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  EASE_OUT,
  SPRING_PANEL,
} from "../../lib/ease";
import { capturePointer, TOUCH_GESTURE_CONTENT_CLASS } from "../../lib/touch";
import { cn } from "../../lib/utils";

export type PullToRefreshStatus =
  | "idle"
  | "pulling"
  | "ready"
  | "refreshing";

export interface PullToRefreshProps {
  /** Runs after the user pulls beyond the threshold and releases. */
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  /** Keeps the indicator active while an externally managed refresh runs. */
  refreshing?: boolean;
  disabled?: boolean;
  /** Resisted pull distance in pixels required to refresh. */
  threshold?: number;
  /** Maximum resisted pull distance in pixels. */
  maxPull?: number;
  /** Content offset in pixels while refreshing. */
  holdDistance?: number;
  pullingLabel?: ReactNode;
  releaseLabel?: ReactNode;
  refreshingLabel?: ReactNode;
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
  indicatorClassName?: string;
}

type Gesture = {
  active: boolean;
  startX: number;
  startY: number;
  pointerId: number | null;
};

const EMPTY_GESTURE: Gesture = {
  active: false,
  startX: 0,
  startY: 0,
  pointerId: null,
};

const LABEL_SWAP = { duration: 0.16, ease: EASE_OUT } as const;

function resistedDistance(distance: number, maxPull: number) {
  return maxPull * (1 - Math.exp(-Math.max(0, distance) / maxPull));
}

function SpinnerRing({
  progress,
  status,
}: {
  progress: MotionValue<number>;
  status: PullToRefreshStatus;
}) {
  const refreshing = status === "refreshing";
  const ready = status === "ready";
  const strokeOffset = useTransform(progress, [0, 1], [50, 15]);

  return (
    <div className="relative size-3.5 shrink-0 flex items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        className={cn(
          "size-3.5 shrink-0",
          refreshing && "animate-spin"
        )}
      >
        {/* Outer Dark Track Circle */}
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-zinc-700/80"
        />
        {/* Active Rotating / Progress Arc */}
        <motion.circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="60"
          strokeDashoffset={refreshing ? 42 : strokeOffset}
          className={cn(
            "text-zinc-200",
            ready && "text-emerald-400"
          )}
        />
      </svg>
    </div>
  );
}

export function PullToRefresh({
  onRefresh,
  children,
  refreshing = false,
  disabled = false,
  threshold = 70,
  maxPull = 120,
  holdDistance = 64,
  pullingLabel = "Tarik untuk refresh telemetry",
  releaseLabel = "Lepaskan untuk memperbarui",
  refreshingLabel = "Memperbarui data telemetry...",
  ariaLabel = "Refreshable telemetry panel",
  className,
  contentClassName,
  indicatorClassName,
}: PullToRefreshProps) {
  const rootRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<Gesture>({ ...EMPTY_GESTURE });
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const statusRef = useRef<PullToRefreshStatus>("idle");
  const disabledRef = useRef(disabled);
  const externalRefreshingRef = useRef(refreshing);
  const refreshingRef = useRef(refreshing);
  const [status, setStatusState] = useState<PullToRefreshStatus>("idle");
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const reduce = useReducedMotion();
  const pullThreshold = Math.max(24, threshold);
  const pullLimit = Math.max(maxPull, pullThreshold + 24);
  const restingDistance = Math.min(
    Math.max(0, holdDistance),
    pullThreshold
  );
  const y = useMotionValue(0);
  const progress = useTransform(y, [0, pullThreshold], [0, 1]);
  const indicatorOpacity = useTransform(
    y,
    [0, 10, pullThreshold],
    [0, 0.45, 1]
  );
  const indicatorScale = useTransform(y, [0, pullThreshold], [0.86, 1]);
  const isRefreshing = refreshing || internalRefreshing;

  disabledRef.current = disabled;
  externalRefreshingRef.current = refreshing;
  refreshingRef.current = isRefreshing;

  const setStatus = useCallback((next: PullToRefreshStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const settle = useCallback(
    (target: number) => {
      animationRef.current?.stop();

      if (reduce) {
        y.set(target);
        return;
      }

      animationRef.current = animate(y, target, SPRING_PANEL);
    },
    [reduce, y]
  );

  const updatePull = useCallback(
    (distance: number) => {
      if (disabledRef.current || refreshingRef.current) return;
      animationRef.current?.stop();

      const next = resistedDistance(distance, pullLimit);
      y.set(next);
      setStatus(next >= pullThreshold ? "ready" : "pulling");
    },
    [pullLimit, pullThreshold, setStatus, y]
  );

  const runRefresh = useCallback(async () => {
    if (disabledRef.current || refreshingRef.current) return;

    setInternalRefreshing(true);
    setStatus("refreshing");
    settle(restingDistance);

    try {
      await onRefresh();
    } finally {
      setInternalRefreshing(false);

      if (!externalRefreshingRef.current) {
        setStatus("idle");
        settle(0);
      }
    }
  }, [onRefresh, restingDistance, setStatus, settle]);

  const finishPull = useCallback(() => {
    const shouldRefresh =
      y.get() >= pullThreshold &&
      !disabledRef.current &&
      !refreshingRef.current;

    gestureRef.current = { ...EMPTY_GESTURE };

    if (shouldRefresh) {
      void runRefresh();
      return;
    }

    setStatus("idle");
    settle(0);
  }, [pullThreshold, runRefresh, setStatus, settle, y]);

  useEffect(() => {
    if (isRefreshing) {
      setStatus("refreshing");
      settle(restingDistance);
      return;
    }

    if (statusRef.current === "refreshing") {
      setStatus("idle");
      settle(0);
    }
  }, [isRefreshing, restingDistance, setStatus, settle]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        root.scrollTop > 0 ||
        disabledRef.current ||
        refreshingRef.current
      ) {
        return;
      }

      const touch = event.touches[0];
      gestureRef.current = {
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        pointerId: null,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = event.touches[0];
      if (!gesture.active || !touch) return;

      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;

      if (root.scrollTop > 0 || deltaY < 0) {
        gestureRef.current = { ...EMPTY_GESTURE };
        return;
      }

      if (Math.abs(deltaX) > deltaY) return;

      event.preventDefault();
      updatePull(deltaY);
    };

    const onTouchEnd = () => {
      if (gestureRef.current.active) finishPull();
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);

    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [finishPull, updatePull]);

  useEffect(() => {
    return () => animationRef.current?.stop();
  }, []);

  const startPointerPull = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.pointerType === "touch" ||
      event.button !== 0 ||
      event.currentTarget.scrollTop > 0 ||
      disabled ||
      isRefreshing
    ) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a, [role="slider"], [role="button"], [data-no-drag]')) {
      return;
    }

    gestureRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  };

  const movePointerPull = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (deltaY < 0 || Math.abs(deltaX) > deltaY) return;

    if (deltaY > 6) {
      capturePointer(event.currentTarget, event.pointerId);
      event.preventDefault();
      updatePull(deltaY);
    }
  };

  const label =
    status === "refreshing"
      ? refreshingLabel
      : status === "ready"
        ? releaseLabel
        : pullingLabel;

  return (
    <section
      ref={rootRef}
      aria-label={ariaLabel}
      aria-busy={isRefreshing}
      data-state={status}
      data-disabled={disabled || undefined}
      onPointerDown={startPointerPull}
      onPointerMove={movePointerPull}
      onPointerUp={(event) => {
        if (gestureRef.current.pointerId === event.pointerId) finishPull();
      }}
      onPointerCancel={(event) => {
        if (gestureRef.current.pointerId === event.pointerId) finishPull();
      }}
      className={cn(
        "relative w-full overflow-y-auto overscroll-contain",
        TOUCH_GESTURE_CONTENT_CLASS,
        status === "pulling" || status === "ready"
          ? "cursor-grabbing select-none"
          : "cursor-grab",
        (disabled || isRefreshing) && "cursor-default",
        className
      )}
    >
      <motion.div
        aria-live="polite"
        aria-atomic="true"
        style={
          reduce
            ? { opacity: indicatorOpacity }
            : { opacity: indicatorOpacity, scale: indicatorScale }
        }
        className={cn(
          "pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center",
          indicatorClassName
        )}
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#121316]/95 backdrop-blur-md border border-white/[0.1] shadow-xl shadow-black/80 text-[11px] font-mono text-zinc-300">
          <SpinnerRing
            progress={progress}
            status={status}
          />
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={status}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 2 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -2 }}
              transition={LABEL_SWAP}
              className="whitespace-nowrap font-medium text-zinc-300"
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div
        style={reduce ? undefined : { y }}
        className={cn(
          "relative z-10 min-h-full will-change-transform",
          contentClassName
        )}
      >
        {children}
      </motion.div>
    </section>
  );
}
