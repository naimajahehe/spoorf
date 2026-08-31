export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const SPRING_LAYOUT = {
    type: "spring" as const,
    stiffness: 350,
    damping: 30,
};

export const SPRING_PRESS = {
    type: "spring" as const,
    stiffness: 500,
    damping: 25,
};

export const SPRING_GLIDE = {
    stiffness: 700,
    damping: 50,
    mass: 0.5,
} as const;

export const SPRING_PANEL = {
    type: "spring" as const,
    stiffness: 420,
    damping: 40,
    mass: 0.5,
};

export const SPRING_SWAP = {
    type: "spring" as const,
    stiffness: 460,
    damping: 30,
    mass: 0.55,
};
