// beui.dev/components/motion/scroll-animation
import { type RefObject } from "react";
import {
  type MotionValue,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { cn } from "../../lib/utils";

// Soft follow so the indicator trails the scroll smoothly instead of snapping
const PROGRESS_SPRING = { stiffness: 120, damping: 30, mass: 0.6 };

type CommonProps = {
  progress?: MotionValue<number>;
  container?: RefObject<HTMLElement>;
  spring?: boolean;
  className?: string;
};

export interface ScrollProgressBarProps extends CommonProps {
  variant?: "bar";
  position?: "top" | "bottom";
  height?: number;
  fixed?: boolean;
}

export interface ScrollProgressCircleProps extends CommonProps {
  variant: "circle";
  size?: number;
  thickness?: number;
}

export type ScrollProgressProps =
  | ScrollProgressBarProps
  | ScrollProgressCircleProps;

function useProgressValue(
  source: MotionValue<number> | undefined,
  container: RefObject<HTMLElement> | undefined,
  spring: boolean
) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ container });
  const raw = source ?? scrollYProgress;
  const smoothed = useSpring(raw, PROGRESS_SPRING);
  return spring && !reduce ? smoothed : raw;
}

export function ScrollProgress(props: ScrollProgressProps) {
  if (props.variant === "circle") return <ScrollProgressCircle {...props} />;
  return <ScrollProgressBar {...props} />;
}

function ScrollProgressBar({
  progress,
  container,
  spring = true,
  position = "top",
  height = 2.5,
  fixed = false,
  className,
}: ScrollProgressBarProps) {
  const value = useProgressValue(progress, container, spring);
  return (
    <motion.div
      aria-hidden
      style={{ height, scaleX: value }}
      className={cn(
        "left-0 right-0 z-20 origin-left bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_12px_rgba(52,211,153,0.4)]",
        fixed ? "fixed" : "absolute",
        position === "top" ? "top-0" : "bottom-0",
        className
      )}
    />
  );
}

function ScrollProgressCircle({
  progress,
  container,
  spring = true,
  size = 32,
  thickness = 2.5,
  className,
}: ScrollProgressCircleProps) {
  const value = useProgressValue(progress, container, spring);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = useTransform(value, (v) => circumference * (1 - v));

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      role="presentation"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("text-emerald-400", className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={thickness}
        className="stroke-white/10"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={thickness}
        strokeLinecap="round"
        className="stroke-current"
        strokeDasharray={circumference}
        style={{ strokeDashoffset: offset }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
