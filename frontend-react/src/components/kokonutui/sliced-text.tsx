import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export interface SlicedTextProps {
    text?: string;
    className?: string;
    containerClassName?: string;
    splitSpacing?: number;
    isHovered?: boolean;
}

export function SlicedText({
    text = "Sliced Text",
    className,
    containerClassName,
    splitSpacing = 2.5,
    isHovered: externalHovered,
}: SlicedTextProps) {
    const [internalHover, setInternalHover] = useState(false);
    const isHovered = externalHovered !== undefined ? externalHovered : internalHover;

    return (
        <span
            className={cn(
                "group/sliced relative inline-block select-none overflow-visible align-middle",
                containerClassName
            )}
            onMouseEnter={() => setInternalHover(true)}
            onMouseLeave={() => setInternalHover(false)}
        >
            {/* Invisible ghost element to preserve layout dimensions */}
            <span className={cn("opacity-0 block pointer-events-none select-none font-semibold", className)}>
                {text}
            </span>

            {/* Top Half */}
            <motion.span
                className={cn(
                    "absolute inset-0 select-none block pointer-events-none transition-transform duration-300 ease-out font-semibold",
                    "group-hover/btn:-translate-y-[2px] group-hover:-translate-y-[2px]",
                    className
                )}
                style={{
                    clipPath: "inset(0 0 50% 0)",
                }}
                animate={externalHovered !== undefined ? {
                    y: isHovered ? -splitSpacing : 0,
                    opacity: isHovered ? 0.9 : 1,
                } : undefined}
                transition={{
                    type: "spring",
                    stiffness: 340,
                    damping: 18,
                }}
            >
                {text}
            </motion.span>

            {/* Bottom Half */}
            <motion.span
                className={cn(
                    "absolute inset-0 select-none block pointer-events-none transition-transform duration-300 ease-out font-semibold",
                    "group-hover/btn:translate-y-[2px] group-hover:translate-y-[2px]",
                    className
                )}
                style={{
                    clipPath: "inset(50% 0 0 0)",
                }}
                animate={externalHovered !== undefined ? {
                    y: isHovered ? splitSpacing : 0,
                    opacity: isHovered ? 0.9 : 1,
                } : undefined}
                transition={{
                    type: "spring",
                    stiffness: 340,
                    damping: 18,
                }}
            >
                {text}
            </motion.span>
        </span>
    );
}

export default SlicedText;
