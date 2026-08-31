import React, { forwardRef } from 'react';

export interface SharedLayoutBgProps extends React.HTMLAttributes<HTMLElement> {
    as?: any;
    children?: React.ReactNode;
    inset?: number;
    pillClassName?: string;
    pillContainerClassName?: string;
}

export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(
    function SharedLayoutBg({ as: Comp = 'div', children, inset, pillClassName, pillContainerClassName, ...props }, ref) {
        return (
            <Comp ref={ref} {...props}>
                {children}
            </Comp>
        );
    }
);
