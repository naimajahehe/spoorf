import type { FC } from 'react';
import { cn } from '../../lib/utils';

interface Props {
    level: 'near' | 'medium' | 'far' | 'offline';
    className?: string;
    size?: number;
}

export const WifiSignalIcon: FC<Props> = ({
    level,
    className,
    size = 16
}) => {
    const defaultColor = level === 'offline' ? 'text-zinc-600' : 'text-zinc-300';

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("shrink-0 transition-colors", className || defaultColor)}
        >
            {/* Top Outer Arc (Bar 3) */}
            <path
                d="M2.5 7.5a14 14 0 0 1 19 0"
                className={level === 'near' ? 'opacity-100' : 'opacity-25'}
            />
            {/* Middle Arc (Bar 2) */}
            <path
                d="M6 11.5a9 9 0 0 1 12 0"
                className={level === 'near' || level === 'medium' ? 'opacity-100' : 'opacity-25'}
            />
            {/* Inner Arc (Bar 1) */}
            <path
                d="M9.5 15.5a4 4 0 0 1 5 0"
                className={level !== 'offline' ? 'opacity-100' : 'opacity-25'}
            />
            {/* Base Center Dot */}
            <circle
                cx="12"
                cy="19"
                r="1.2"
                fill="currentColor"
                stroke="none"
                className={level !== 'offline' ? 'opacity-100' : 'opacity-25'}
            />
        </svg>
    );
};
