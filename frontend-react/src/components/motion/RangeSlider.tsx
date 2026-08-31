import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { useEffect } from "react";

import { SPRING_GLIDE } from "../../lib/ease";
import { type SliderOptions, useSlider } from "../../lib/hooks/use-slider";
import { TOUCH_GESTURE_CLASS } from "../../lib/touch";
import { cn } from "../../lib/utils";

// Bouncy grab feedback for the thumb scale only.
const SPRING_BOUNCY = { type: "spring", stiffness: 500, damping: 14, mass: 0.7 } as const;

export interface RangeSliderProps extends SliderOptions {
  /** Render a tick dot at each step. */
  showTicks?: boolean;
  className?: string;
  fillClassName?: string;
}

export function RangeSlider({ showTicks = true, className, fillClassName, ...options }: RangeSliderProps) {
  const reduce = useReducedMotion();
  const { percent, dragging, min, max, step, trackProps, sliderProps } = useSlider(options);

  // Spring-smoothed position drives both the thumb and the fill.
  const target = useMotionValue(percent);
  useEffect(() => {
    target.set(percent);
  }, [percent, target]);
  const smooth = useSpring(target, SPRING_GLIDE);
  const pos = reduce ? target : smooth;
  const left = useMotionTemplate`${pos}%`;
  const thumbX = useTransform(pos, (p) => `${-p}%`);

  const steps = Math.floor(Number(((max - min) / step).toFixed(6)));
  const ticks =
    showTicks && steps > 0 && steps <= 50
      ? Array.from({ length: steps + 1 }, (_, i) => Number((min + i * step).toFixed(6)))
      : [];

  return (
    <div
      {...trackProps}
      className={cn(
        "relative flex h-8 w-full touch-none items-center overflow-hidden rounded-lg bg-white/[0.04] border border-white/[0.08]",
        TOUCH_GESTURE_CLASS,
        options.disabled
          ? "pointer-events-none opacity-40"
          : "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      {/* fill — runs from the left edge to the thumb, consistent tone */}
      <motion.div 
        className={cn("absolute inset-y-0 left-0 bg-emerald-500/20", fillClassName)} 
        style={{ width: left }} 
      />

      {/* Ticks, inset by half the thumb's width. */}
      <div className="pointer-events-none absolute inset-x-[4px] inset-y-0">
        {ticks.map((t) => {
          const tp = ((t - min) / (max - min)) * 100;
          return (
            <span
              key={t}
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20"
              style={{ left: `${tp}%` }}
            />
          );
        })}
      </div>

      {/* vertical bar thumb — contained at both ends via thumbX */}
      <motion.div
        {...sliderProps}
        animate={reduce ? undefined : { scaleY: dragging ? 1.35 : 1 }}
        transition={SPRING_BOUNCY}
        className="absolute top-1/2 h-5 w-1.5 rounded-sm bg-white shadow-md outline-none ring-inset ring-white/30 focus-visible:ring-2 cursor-grab active:cursor-grabbing"
        style={{ left, x: thumbX, y: "-50%" }}
      />
    </div>
  );
}
