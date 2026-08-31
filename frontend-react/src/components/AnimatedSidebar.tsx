import { SlicedText } from "./kokonutui/sliced-text";
import { ChevronRight, Command, LayoutDashboard, GlobeOff, Terminal, Settings, Search, PanelLeft, Radio, Zap, ShieldCheck, Gamepad2 } from "lucide-react";
import {
  AnimatePresence,
  type HTMLMotionProps,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { SharedLayoutBg } from "./motion/shared-layout-bg";
import {
  EASE_DRAWER,
  EASE_OUT,
  SPRING_LAYOUT,
  SPRING_PRESS,
} from "../lib/ease";
import { cn } from "../lib/utils";
import { Device, AuthStatusResponse } from "../types";

type SidebarState = "expanded" | "collapsed";
type SidebarSide = "left" | "right";
type SidebarVariant = "sidebar" | "floating" | "inset";
type SidebarCollapsible = "offcanvas" | "icon" | "none";

const MOBILE_QUERY = "(max-width: 767px)";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

const PANEL_TRANSITION = {
  duration: 0.36,
  ease: EASE_DRAWER,
} as const;

// The desktop rail settles at a hard zero-width boundary. Keep the spring
// critically damped so it cannot overshoot, pause against that boundary, and
// then snap back during the final frame.
const SIDEBAR_MORPH_TRANSITION = {
  type: "spring",
  stiffness: 380,
  damping: 35,
  mass: 0.75,
} as const;


const SUBMENU_TRANSITION = {
  duration: 0.18,
  ease: EASE_OUT,
} as const;

const SUBMENU_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    clipPath: "inset(0 0 100% 0 round 8px)",
    transition: {
      duration: 0.14,
      ease: EASE_OUT,
      staggerChildren: 0.025,
      staggerDirection: -1,
    },
  },
  open: {
    opacity: 1,
    clipPath: "inset(0 0 0% 0 round 8px)",
    transition: {
      duration: 0.2,
      delayChildren: 0.035,
      ease: EASE_OUT,
      staggerChildren: 0.045,
    },
  },
};

const SUBMENU_ITEM_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    y: -6,
    filter: "blur(3px)",
  },
  open: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: SUBMENU_TRANSITION,
  },
};

const REDUCED_TRANSITION = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function subscribeToMobileQuery(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerMobileSnapshot() {
  return false;
}

function useIsMobile() {
  return useSyncExternalStore(
    subscribeToMobileQuery,
    getMobileSnapshot,
    getServerMobileSnapshot,
  );
}

interface AnimatedSidebarContextValue {
  isMobile: boolean;
  layoutId: string;
  open: boolean;
  openMobile: boolean;
  reduce: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  state: SidebarState;
  toggleSidebar: () => void;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
}

const AnimatedSidebarContext =
  createContext<AnimatedSidebarContextValue | null>(null);

interface AnimatedSidebarPanelContextValue {
  collapsed: boolean;
  collapsible: SidebarCollapsible;
  side: SidebarSide;
}

const AnimatedSidebarPanelContext =
  createContext<AnimatedSidebarPanelContextValue | null>(null);

export function useAnimatedSidebar() {
  const context = useContext(AnimatedSidebarContext);
  if (!context) {
    return {
      isMobile: false,
      layoutId: "sidebar-active",
      open: false,
      openMobile: false,
      reduce: false,
      setOpen: () => {},
      setOpenMobile: () => {},
      state: "collapsed" as SidebarState,
      toggleSidebar: () => {},
      triggerRef: { current: null },
    };
  }
  return context;
}

export function useAnimatedSidebarPanel() {
  const context = useContext(AnimatedSidebarPanelContext);
  if (!context) {
    return {
      collapsed: true,
      collapsible: "icon" as SidebarCollapsible,
      side: "left" as SidebarSide,
    };
  }
  return context;
}

type SidebarProviderStyle = CSSProperties & {
  "--sidebar-width"?: string;
  "--sidebar-width-icon"?: string;
  "--sidebar-width-mobile"?: string;
};

export interface AnimatedSidebarProviderProps
  extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openMobile?: boolean;
  defaultOpenMobile?: boolean;
  onOpenMobileChange?: (open: boolean) => void;
  style?: SidebarProviderStyle;
}

export function AnimatedSidebarProvider({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  openMobile,
  defaultOpenMobile = false,
  onOpenMobileChange,
  className,
  style,
  ...props
}: AnimatedSidebarProviderProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalOpenMobile, setInternalOpenMobile] =
    useState(defaultOpenMobile);
  const isMobile = useIsMobile();
  const reduce = useReducedMotion() ?? false;
  const generatedId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktopOpen = open ?? internalOpen;
  const mobileOpen = openMobile ?? internalOpenMobile;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );

  const setOpenMobile = useCallback(
    (nextOpen: boolean) => {
      if (openMobile === undefined) setInternalOpenMobile(nextOpen);
      onOpenMobileChange?.(nextOpen);
    },
    [onOpenMobileChange, openMobile],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(!mobileOpen);
    else setOpen(!desktopOpen);
  }, [desktopOpen, isMobile, mobileOpen, setOpen, setOpenMobile]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleSidebar]);

  return (
    <AnimatedSidebarContext.Provider
      value={{
        isMobile,
        layoutId: `${generatedId}-active`,
        open: desktopOpen,
        openMobile: mobileOpen,
        reduce,
        setOpen,
        setOpenMobile,
        state: desktopOpen ? "expanded" : "collapsed",
        toggleSidebar,
        triggerRef,
      }}
    >
      <div
        {...props}
        data-slot="sidebar-wrapper"
        data-state={desktopOpen ? "expanded" : "collapsed"}
        style={{
          "--sidebar-width": "16rem",
          "--sidebar-width-icon": "4.5rem",
          "--sidebar-width-mobile": "18rem",
          ...style,
        }}
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full min-w-0",
          className,
        )}
      >
        {children}
      </div>
    </AnimatedSidebarContext.Provider>
  );
}

function MobileSidebar({
  ariaLabel,
  children,
  className,
  side,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  side: SidebarSide;
}) {
  const context = useAnimatedSidebar();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(!context.openMobile);
  const openMobileRef = useRef(context.openMobile);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    openMobileRef.current = context.openMobile;
    if (context.openMobile) setHidden(false);
  }, [context.openMobile]);

  useEffect(() => {
    if (!context.openMobile) return;

    const body = document.body;
    const scrollY = window.scrollY;
    const previousBodyStyles = {
      left: body.style.left,
      overflow: body.style.overflow,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";

    const focusFrame = requestAnimationFrame(() => {
      const firstFocusable =
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? panelRef.current)?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.overflow = previousBodyStyles.overflow;
      window.scrollTo(0, scrollY);
      context.triggerRef.current?.focus({ preventScroll: true });
    };
  }, [context.openMobile, context.triggerRef]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed left-0 top-0 z-50 size-0 md:hidden",
        hidden && !context.openMobile ? "invisible" : "visible",
      )}
    >
      <motion.button
        type="button"
        aria-label="Close sidebar"
        tabIndex={context.openMobile ? 0 : -1}
        initial={false}
        animate={{ opacity: context.openMobile ? 1 : 0 }}
        transition={
          context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION
        }
        onClick={() => context.setOpenMobile(false)}
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm",
          context.openMobile
            ? "pointer-events-auto"
            : "pointer-events-none",
        )}
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-hidden={!context.openMobile}
        tabIndex={-1}
        data-mobile="true"
        data-state={context.openMobile ? "expanded" : "collapsed"}
        data-side={side}
        initial={false}
        animate={{
          opacity: context.reduce
            ? context.openMobile
              ? 1
              : 0
            : 1,
          x: context.reduce
            ? 0
            : context.openMobile
              ? "0%"
              : side === "left"
                ? "-100%"
                : "100%",
        }}
        transition={
          context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION
        }
        onAnimationComplete={() => {
          if (!openMobileRef.current) setHidden(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            context.setOpenMobile(false);
            return;
          }

          if (event.key !== "Tab") return;
          const focusable = panelRef.current
            ? Array.from(
                panelRef.current.querySelectorAll<HTMLElement>(
                  FOCUSABLE_SELECTOR,
                ),
              )
            : [];

          if (focusable.length === 0) {
            event.preventDefault();
            panelRef.current?.focus();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className={cn(
          "pointer-events-auto fixed inset-y-0 flex h-dvh w-[var(--sidebar-width-mobile)] max-w-[88vw] flex-col overflow-hidden",
          "border-border bg-background shadow-2xl will-change-transform",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          !context.openMobile && "pointer-events-none",
          className,
        )}
      >
        <AnimatedSidebarPanelContext.Provider
          value={{ collapsed: false, collapsible: "none", side }}
        >
          {children}
        </AnimatedSidebarPanelContext.Provider>
      </motion.div>
    </div>,
    document.body,
  );
}

export interface AnimatedSidebarProps
  extends Omit<HTMLMotionProps<"aside">, "children"> {
  children?: ReactNode;
  side?: SidebarSide;
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
  ariaLabel?: string;
  panelClassName?: string;
  // Tailored App props for backward compatibility / direct usage:
  gateway?: Device | null;
  isConnected?: boolean;
  activeNav?: string;
  onNavSelect?: (nav: string) => void;
  totalHosts?: number;
  blockedHosts?: number;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  authStatus?: AuthStatusResponse;
  onOpenAuthModal?: () => void;
  onOpenUpgradeModal?: () => void;
  onOpenSearch?: () => void;
}

export const AnimatedSidebar = forwardRef<HTMLElement, AnimatedSidebarProps>(
  function AnimatedSidebar(
    {
      side = "left",
      variant = "sidebar",
      collapsible = "icon",
      ariaLabel = "Sidebar",
      children,
      className,
      panelClassName,
      style,
      // Tailored app props
      gateway,
      isConnected = true,
      activeNav = "dashboard",
      onNavSelect,
      totalHosts = 0,
      blockedHosts = 0,
      isMobileOpen,
      onCloseMobile,
      collapsed: explicitCollapsed,
      onToggleCollapse,
      authStatus,
      onOpenAuthModal,
      onOpenUpgradeModal,
      onOpenSearch,
      ...props
    },
    forwardedRef,
  ) {
    const context = useAnimatedSidebar();
    const isExplicitCollapsed = explicitCollapsed !== undefined ? explicitCollapsed : undefined;
    const collapsed = isExplicitCollapsed ?? (collapsible !== "none" && !context.open);
    const offcanvas = collapsed && collapsible === "offcanvas";
    const width = offcanvas
      ? "0px"
      : collapsed
        ? "var(--sidebar-width-icon)"
        : "var(--sidebar-width)";

    // If children are not explicitly passed, render the tailored Sentinel app navigation
    const content = children ?? (
      <>
        {/* Workspace Brand Header (Aligned h-16 with right topbar header & centered) */}
        <AnimatedSidebarHeader className="h-16 border-b border-white/[0.08] px-3 flex items-center justify-center shrink-0">
          <div className={cn("flex items-center gap-3 min-w-0 overflow-hidden", collapsed ? "justify-center w-full" : "w-full justify-start px-1")}>
            <div className="size-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0 shadow-sm">
              <Command size={16} className="stroke-[2.5]" />
            </div>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                className="flex flex-col min-w-0 overflow-hidden text-left select-none"
              >
                <span className="font-bold text-sm text-white tracking-tight leading-none truncate">
                  Sentinel Ops
                </span>
                <span className="text-[10px] font-mono text-zinc-500 tracking-wider uppercase mt-1 leading-none">
                  Network Shield
                </span>
              </motion.div>
            )}
          </div>
        </AnimatedSidebarHeader>

        {/* Navigation Sections */}
        <AnimatedSidebarContent>
          {/* Top Search Item */}
          <AnimatedSidebarGroup>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>
                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={false}
                    onSelect={() => {
                      if (onOpenSearch) {
                        onOpenSearch();
                      } else {
                        onNavSelect?.("search");
                      }
                    }}
                    icon={<Search size={18} />}
                    badge={!collapsed ? <kbd className="text-[10px] font-mono bg-white/[0.08] px-1.5 py-0.5 rounded border border-white/[0.1] text-zinc-400">⌘K</kbd> : undefined}
                  >
                    Search
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              </AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>

          {/* Main Surveillance Group */}
          <AnimatedSidebarGroup>
            <AnimatedSidebarGroupLabel>SURVEILLANCE</AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>
                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "dashboard"}
                    onSelect={() => onNavSelect?.("dashboard")}
                    icon={<LayoutDashboard size={18} />}
                  >
                    Dashboard
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>

                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "netcut"}
                    onSelect={() => onNavSelect?.("netcut")}
                    icon={<GlobeOff size={18} />}
                    badge={blockedHosts !== undefined && blockedHosts > 0 ? `${blockedHosts} CUT` : totalHosts > 0 ? totalHosts : undefined}
                  >
                    <SlicedText text="NetCut" splitSpacing={2} />
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>

                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "gateway"}
                    onSelect={() => onNavSelect?.("gateway")}
                    icon={<Radio size={18} />}
                    badge={authStatus?.license?.tier === 'free' ? "PRO" : undefined}
                  >
                    Smart Gateway
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>

                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "arsenal"}
                    onSelect={() => onNavSelect?.("arsenal")}
                    icon={<Zap size={18} />}
                    badge={authStatus?.license?.tier !== 'vip' ? "VIP" : undefined}
                  >
                    Security Arsenal
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>

                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "gaming"}
                    onSelect={() => onNavSelect?.("gaming")}
                    icon={<Gamepad2 size={18} className="text-cyan-400" />}
                    badge="VIP"
                  >
                    Mode Gaming
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>

                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "shield"}
                    onSelect={() => onNavSelect?.("shield")}
                    icon={<ShieldCheck size={18} />}
                  >
                    Sentinel Shield
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>

                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "activity"}
                    onSelect={() => onNavSelect?.("activity")}
                    icon={<Terminal size={18} />}
                  >
                    Aktivitas Langsung
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              </AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>

          {/* Preferences Group */}
          <AnimatedSidebarGroup>
            <AnimatedSidebarGroupLabel>PREFERENCES</AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>
                <AnimatedSidebarMenuItem>
                  <AnimatedSidebarMenuButton
                    isActive={activeNav === "settings"}
                    onSelect={() => onNavSelect?.("settings")}
                    icon={<Settings size={18} />}
                  >
                    Settings
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              </AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>
        </AnimatedSidebarContent>

        {/* Footer User Profile Card & Collapse Toggle Button */}
        <AnimatedSidebarFooter className={cn(
          "border-t border-white/[0.08] mt-auto sticky bottom-0 bg-[#090a0c] shrink-0 transition-all flex flex-col gap-1.5",
          collapsed ? "p-2 items-center" : "p-3"
        )}>
          {/* Collapse/Expand Toggle Button in Sidebar (Clean icon without text) */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-all border border-transparent hover:border-white/[0.06] shrink-0",
              collapsed
                ? "size-10 p-0 mx-auto"
                : "w-full h-8 px-2"
            )}
            title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            aria-label={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <PanelLeft size={16} className={cn("shrink-0 transition-transform duration-200", collapsed && "rotate-180")} />
          </button>

          {/* User Profile */}
          <div
            onClick={onOpenAuthModal}
            className={cn(
              "flex items-center rounded-xl hover:bg-white/[0.06] transition-colors cursor-pointer select-none",
              collapsed ? "size-8 justify-center p-0 mx-auto" : "w-full p-2 gap-3"
            )}
            title={`Akun: ${authStatus?.user?.name || authStatus?.user?.email || 'Guest'} (${(authStatus?.license?.tier || 'free').toUpperCase()}) - Klik untuk kelola`}
          >
            <div className={cn(
              "size-8 rounded-full border font-semibold flex items-center justify-center text-xs relative shrink-0",
              authStatus?.license?.tier === 'vip' ? "bg-amber-500/20 border-amber-500/40 text-amber-200" :
              authStatus?.license?.tier === 'pro' ? "bg-purple-500/20 border-purple-500/40 text-purple-200" :
              "bg-white/[0.08] border-white/[0.12] text-zinc-200"
            )}>
              <span>{authStatus?.user?.name ? authStatus.user.name.substring(0, 2).toUpperCase() : 'SP'}</span>
              <span className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-[#090a0c]",
                isConnected ? "bg-emerald-500" : "bg-zinc-500"
              )} />
            </div>
            {!collapsed && (
              <>
                <div className="flex flex-col text-left truncate flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-xs font-semibold text-white truncate">
                      {authStatus?.user?.name || authStatus?.user?.email || 'Spoorfer Guest'}
                    </span>
                    <span className={cn(
                      "px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase shrink-0",
                      authStatus?.license?.tier === 'vip' ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                      authStatus?.license?.tier === 'pro' ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
                      "bg-zinc-800 text-zinc-400 border border-zinc-700"
                    )}>
                      {authStatus?.license?.tier || 'FREE'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 truncate">
                    {authStatus?.user?.email || 'Klik untuk Aktivasi Lisensi'}
                  </span>
                </div>
                <ChevronRight size={14} className="text-zinc-500 shrink-0 ml-auto" />
              </>
            )}
          </div>
        </AnimatedSidebarFooter>
      </>
    );

    if (context.isMobile) {
      return (
        <MobileSidebar
          ariaLabel={ariaLabel}
          className={className}
          side={side}
        >
          {content}
        </MobileSidebar>
      );
    }

    return (
      <AnimatedSidebarPanelContext.Provider
        value={{ collapsed, collapsible, side }}
      >
        <motion.aside
          {...props}
          ref={forwardedRef}
          initial={false}
          aria-label={ariaLabel}
          data-slot="sidebar"
          data-state={collapsed ? "collapsed" : "expanded"}
          data-collapsible={collapsible}
          data-variant={variant}
          data-side={side}
          animate={{ width }}
          transition={
            context.reduce ? { duration: 0 } : SIDEBAR_MORPH_TRANSITION
          }
          style={style}
          className={cn(
            "group/sidebar sticky top-0 left-0 hidden h-screen shrink-0 md:block will-change-[width] bg-[#090a0c] border-r border-white/[0.08] z-30 self-start",
            "peer",
            side === "right" && "order-last",
            className,
          )}
        >
          <motion.div
            initial={false}
            animate={{
              opacity: offcanvas ? 0 : 1,
              x: offcanvas ? (side === "left" ? "-100%" : "100%") : "0%",
            }}
            transition={
              context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION
            }
            className={cn(
              "flex h-screen w-full flex-col justify-between overflow-hidden bg-[#090a0c]",
              collapsible === "offcanvas" && "w-[var(--sidebar-width)]",
              variant === "sidebar" &&
                (side === "left" ? "border-border border-r" : "border-border border-l"),
              variant === "floating" &&
                "m-2 h-[calc(100svh-1rem)] rounded-2xl border border-border shadow-sm",
              variant === "inset" && "m-2 h-[calc(100svh-1rem)] rounded-2xl",
              panelClassName,
            )}
          >
            {content}
          </motion.div>
          <AnimatedSidebarRail />
        </motion.aside>
      </AnimatedSidebarPanelContext.Provider>
    );
  },
);

export interface AnimatedSidebarTriggerProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const AnimatedSidebarTrigger = forwardRef<
  HTMLButtonElement,
  AnimatedSidebarTriggerProps
>(function AnimatedSidebarTrigger(
  { className, onClick, type = "button", ...props },
  forwardedRef,
) {
  const context = useAnimatedSidebar();
  const expanded = context.isMobile ? context.openMobile : context.open;

  return (
    <button
      {...props}
      ref={(node) => {
        context.triggerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) (forwardedRef as any).current = node;
      }}
      type={type}
      aria-label={props["aria-label"] ?? "Toggle sidebar"}
      aria-expanded={expanded}
      data-slot="sidebar-trigger"
      data-state={expanded ? "expanded" : "collapsed"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) context.toggleSidebar();
      }}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none",
        "text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ChevronRight
        size={14}
        className={cn(
          "transition-transform duration-200",
          expanded ? "rotate-180" : "rotate-0",
        )}
      />
    </button>
  );
});

export interface AnimatedSidebarCloseProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const AnimatedSidebarClose = forwardRef<
  HTMLButtonElement,
  AnimatedSidebarCloseProps
>(function AnimatedSidebarClose(
  { className, onClick, type = "button", ...props },
  forwardedRef,
) {
  const context = useAnimatedSidebar();

  return (
    <button
      {...props}
      ref={forwardedRef}
      type={type}
      aria-label={props["aria-label"] ?? "Close sidebar"}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (context.isMobile) context.setOpenMobile(false);
        else context.setOpen(false);
      }}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
});

export interface AnimatedSidebarRailProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const AnimatedSidebarRail = forwardRef<
  HTMLButtonElement,
  AnimatedSidebarRailProps
>(function AnimatedSidebarRail(
  { className, onClick, type = "button", ...props },
  forwardedRef,
) {
  const context = useAnimatedSidebar();
  const panel = useAnimatedSidebarPanel();

  return (
    <button
      {...props}
      ref={forwardedRef}
      type={type}
      data-side={panel.side}
      aria-label={props["aria-label"] ?? "Toggle sidebar"}
      title="Toggle sidebar"
      tabIndex={-1}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) context.toggleSidebar();
      }}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 outline-none md:block",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-border",
        "data-[side=right]:right-0 data-[side=right]:translate-x-1/2 data-[side=left]:left-full",
        className,
      )}
    />
  );
});

export interface AnimatedSidebarInsetProps
  extends HTMLMotionProps<"main"> {}

export const AnimatedSidebarInset = forwardRef<
  HTMLElement,
  AnimatedSidebarInsetProps
>(function AnimatedSidebarInset({ className, ...props }, forwardedRef) {
  return (
    <motion.main
      {...props}
      ref={forwardedRef}
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-h-svh min-w-0 flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-sm",
        className,
      )}
    />
  );
});

export const AnimatedSidebarHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function AnimatedSidebarHeader({ className, ...props }, forwardedRef) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <div
      {...props}
      ref={forwardedRef}
      data-slot="sidebar-header"
      className={cn(
        "h-16 flex items-center shrink-0 transition-all pt-2",
        collapsed ? "justify-center px-0" : "px-3.5",
        className
      )}
    />
  );
});

export const AnimatedSidebarContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function AnimatedSidebarContent({ className, ...props }, forwardedRef) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <div
      {...props}
      ref={forwardedRef}
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain py-2 transition-all",
        collapsed ? "px-0 items-center" : "px-2",
        className,
      )}
    />
  );
});

export const AnimatedSidebarFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function AnimatedSidebarFooter({ className, ...props }, forwardedRef) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <div
      {...props}
      ref={forwardedRef}
      data-slot="sidebar-footer"
      className={cn(
        "flex shrink-0 flex-col gap-2 border-border border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-all",
        collapsed ? "p-2 items-center" : "p-3",
        className,
      )}
    />
  );
});

export const AnimatedSidebarGroup = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function AnimatedSidebarGroup({ className, ...props }, forwardedRef) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <div
      {...props}
      ref={forwardedRef}
      data-slot="sidebar-group"
      className={cn(
        "flex w-full min-w-0 flex-col py-1.5 transition-all",
        collapsed ? "px-0 items-center" : "px-1",
        className
      )}
    />
  );
});

export const AnimatedSidebarGroupLabel = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function AnimatedSidebarGroupLabel(
  { children, className, ...props },
  forwardedRef,
) {
  const { collapsed } = useAnimatedSidebarPanel();

  if (collapsed) {
    return (
      <div className="my-2 mx-auto w-6 border-t border-white/[0.08]" />
    );
  }

  return (
    <div
      {...props}
      ref={forwardedRef}
      aria-hidden={collapsed}
      data-slot="sidebar-group-label"
      className={cn(
        "mb-1 h-7 overflow-hidden px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-opacity",
        className,
      )}
    >
      {children}
    </div>
  );
});

export const AnimatedSidebarGroupContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function AnimatedSidebarGroupContent(
  { className, ...props },
  forwardedRef,
) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <div
      {...props}
      ref={forwardedRef}
      data-slot="sidebar-group-content"
      className={cn(
        "w-full min-w-0 transition-all",
        collapsed && "flex flex-col items-center",
        className
      )}
    />
  );
});

export const AnimatedSidebarMenu = forwardRef<
  HTMLUListElement,
  HTMLAttributes<HTMLUListElement>
>(function AnimatedSidebarMenu(
  { children, className, ...props },
  forwardedRef,
) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <SharedLayoutBg
      {...props}
      ref={forwardedRef as React.Ref<HTMLElement>}
      as="ul"
      inset={0}
      pillClassName={cn("rounded-xl bg-muted/70", collapsed && "w-10 h-10 left-1/2 -translate-x-1/2")}
      pillContainerClassName={cn("inset-y-auto top-0", collapsed ? "h-10" : "h-9")}
      data-slot="sidebar-menu"
      className={cn(
        "flex w-full min-w-0 list-none flex-col gap-1 transition-all",
        collapsed && "items-center",
        className
      )}
    >
      {children}
    </SharedLayoutBg>
  );
});

export const AnimatedSidebarMenuItem = forwardRef<
  HTMLLIElement,
  HTMLMotionProps<"li">
>(function AnimatedSidebarMenuItem({ className, ...props }, forwardedRef) {
  const { collapsed } = useAnimatedSidebarPanel();
  return (
    <motion.li
      {...props}
      ref={forwardedRef}
      layout="position"
      transition={SPRING_LAYOUT}
      data-slot="sidebar-menu-item"
      className={cn(
        "relative transition-all",
        collapsed ? "size-10 flex items-center justify-center mx-auto" : "w-full",
        className
      )}
    />
  );
});

export interface AnimatedSidebarMenuSubProps
  extends Omit<HTMLMotionProps<"ul">, "children"> {
  open: boolean;
  children?: ReactNode;
}

export const AnimatedSidebarMenuSub = forwardRef<
  HTMLUListElement,
  AnimatedSidebarMenuSubProps
>(function AnimatedSidebarMenuSub(
  { open, children, className, ...props },
  forwardedRef,
) {
  const context = useAnimatedSidebar();
  const panel = useAnimatedSidebarPanel();

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {open && !panel.collapsed ? (
        <motion.ul
          {...props}
          ref={forwardedRef}
          key="sidebar-submenu"
          variants={context.reduce ? undefined : SUBMENU_VARIANTS}
          initial={context.reduce ? false : "closed"}
          animate={context.reduce ? { opacity: 1 } : "open"}
          exit={context.reduce ? { opacity: 0 } : "closed"}
          transition={context.reduce ? { duration: 0.12 } : undefined}
          data-slot="sidebar-menu-sub"
          className={cn(
            "relative mt-1 ml-5 flex min-w-0 flex-col gap-0.5 border-border border-l pl-3",
            className,
          )}
        >
          {children}
        </motion.ul>
      ) : null}
    </AnimatePresence>
  );
});

export const AnimatedSidebarMenuSubItem = forwardRef<
  HTMLLIElement,
  HTMLMotionProps<"li">
>(function AnimatedSidebarMenuSubItem(
  { className, ...props },
  forwardedRef,
) {
  return (
    <motion.li
      {...props}
      ref={forwardedRef}
      variants={SUBMENU_ITEM_VARIANTS}
      data-slot="sidebar-menu-sub-item"
      className={cn("relative min-w-0", className)}
    />
  );
});

export interface AnimatedSidebarMenuSubButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  isActive?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
  onSelect?: () => void;
  className?: string;
}

export function AnimatedSidebarMenuSubButton({
  children,
  icon,
  href,
  isActive = false,
  disabled = false,
  closeOnSelect = true,
  target,
  rel,
  onSelect,
  className,
}: AnimatedSidebarMenuSubButtonProps) {
  const context = useAnimatedSidebar();

  const select = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSelect?.();
    if (context.isMobile && closeOnSelect) context.setOpenMobile(false);
  };

  const content = (
    <>
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center"
      >
        {icon ?? <span className="size-1 rounded-full bg-current" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );

  const interactiveClassName = cn(
    "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs outline-none",
    "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
    "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
    isActive && "bg-muted/70 text-foreground",
    disabled && "cursor-not-allowed opacity-40",
    className,
  );

  return href ? (
    <motion.a
      href={href}
      target={target}
      rel={
        rel ??
        (target === "_blank" ? "noreferrer noopener" : undefined)
      }
      aria-current={isActive ? "page" : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </motion.a>
  ) : (
    <motion.button
      type="button"
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </motion.button>
  );
}

export interface AnimatedSidebarMenuButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  href?: string;
  isActive?: boolean;
  ariaExpanded?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
  onSelect?: () => void;
  className?: string;
}

export function AnimatedSidebarMenuButton({
  children,
  icon,
  badge,
  href,
  isActive = false,
  ariaExpanded,
  disabled = false,
  closeOnSelect,
  target,
  rel,
  onSelect,
  className,
}: AnimatedSidebarMenuButtonProps) {
  const context = useAnimatedSidebar();
  const panel = useAnimatedSidebarPanel();
  const textLabel = typeof children === "string" ? children : undefined;

  const select = (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSelect?.();
    const shouldCloseOnSelect =
      closeOnSelect ?? ariaExpanded === undefined;
    if (context.isMobile && shouldCloseOnSelect) {
      context.setOpenMobile(false);
    }
    if (ariaExpanded !== undefined && panel.collapsed && !context.isMobile) {
      context.setOpen(true);
    }
  };

  const content = (
    <>
      {isActive ? (
        <motion.span
          layoutId={context.layoutId}
          transition={context.reduce ? { duration: 0 } : SPRING_LAYOUT}
          className={cn(
            "absolute inset-0 rounded-xl bg-white/[0.08] pointer-events-none",
            panel.collapsed && "rounded-xl border border-white/[0.1]"
          )}
        />
      ) : null}
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "sidebar-item-icon-wrap relative z-10 shrink-0 flex items-center justify-center",
            panel.collapsed ? "size-10" : ""
          )}
        >
          {icon}
          {panel.collapsed && badge ? (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-zinc-300 ring-2 ring-[#090a0c]" />
          ) : null}
        </span>
      ) : null}
      {!panel.collapsed && (
        <span className="sidebar-item-label relative z-10 min-w-0 flex-1 truncate font-medium text-left">
          {children}
        </span>
      )}
      {!panel.collapsed && badge ? (
        <span className="relative z-10 shrink-0 font-mono text-xs text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
          {badge}
        </span>
      ) : null}
      {!panel.collapsed && isActive && (
        <ChevronRight size={13} className="relative z-10 text-muted-foreground opacity-60 ml-auto" />
      )}
      {!panel.collapsed && ariaExpanded !== undefined ? (
        <motion.span
          aria-hidden="true"
          initial={false}
          animate={{
            rotate: ariaExpanded ? 90 : 0,
            x: 0,
          }}
          transition={context.reduce ? { duration: 0 } : SPRING_LAYOUT}
          className="relative z-10 grid size-4 shrink-0 place-items-center text-muted-foreground"
        >
          <ChevronRight className="size-3.5" />
        </motion.span>
      ) : null}
    </>
  );

  const interactiveClassName = cn(
    "group/btn relative flex items-center overflow-hidden rounded-xl outline-none transition-all",
    "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
    "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
    isActive && "text-foreground font-semibold bg-white/[0.04]",
    disabled && "cursor-not-allowed opacity-40",
    panel.collapsed
      ? "size-10 justify-center p-0 mx-auto"
      : "w-full min-h-9 min-w-0 gap-2.5 px-2.5 text-left text-sm font-medium",
    className,
  );

  return href ? (
    <motion.a
      href={href}
      target={target}
      rel={
        rel ??
        (target === "_blank" ? "noreferrer noopener" : undefined)
      }
      aria-current={isActive ? "page" : undefined}
      aria-expanded={ariaExpanded}
      aria-disabled={disabled || undefined}
      aria-label={panel.collapsed ? textLabel : undefined}
      title={panel.collapsed ? textLabel : undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.96 }}
      data-slot="sidebar-menu-button"
      className={cn("sidebar-menu-btn", interactiveClassName)}
    >
      {content}
    </motion.a>
  ) : (
    <motion.button
      type="button"
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      aria-expanded={ariaExpanded}
      aria-label={panel.collapsed ? textLabel : undefined}
      title={panel.collapsed ? textLabel : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.96 }}
      transition={SPRING_PRESS}
      data-slot="sidebar-menu-button"
      className={cn("sidebar-menu-btn", interactiveClassName)}
    >
      {content}
    </motion.button>
  );
}
