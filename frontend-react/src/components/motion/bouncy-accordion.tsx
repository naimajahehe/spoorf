// beui.dev/components/motion/bouncy-accordion
import {
  motion,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

export type BouncyAccordionItem = {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  disabled?: boolean;
  content: ReactNode;
};

export type BouncyAccordionClassNames = {
  root?: string;
  item?: string;
  trigger?: string;
  icon?: string;
  title?: string;
  chevron?: string;
  content?: string;
};

export interface BouncyAccordionProps {
  items: BouncyAccordionItem[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  collapsible?: boolean;
  className?: string;
  classNames?: BouncyAccordionClassNames;
}

// Local springs keep the accordion's connected groups moving together while
// avoiding scale projection on text-heavy row contents.
const ROW_TRANSITION: Transition = {
  type: "spring",
  duration: 0.55,
  bounce: 0.38,
};

const CONTENT_OPEN_TRANSITION: Transition = {
  type: "spring",
  duration: 0.58,
  bounce: 0.32,
};

const CONTENT_CLOSE_TRANSITION: Transition = {
  type: "spring",
  duration: 0.46,
  bounce: 0.26,
};

const DESCRIPTION_TRANSITION: Transition = {
  duration: 0.18,
  ease: EASE_OUT,
};

const CHEVRON_TRANSITION: Transition = {
  type: "spring",
  duration: 0.42,
  bounce: 0.28,
};

function useControllableAccordionValue({
  value,
  defaultValue,
  onValueChange,
}: {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? null);
  const isControlled = value !== undefined;
  const currentValue = value ?? internalValue;

  const setValue = useCallback(
    (next: string | null) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      onValueChange?.(next);
    },
    [isControlled, onValueChange]
  );

  return [currentValue, setValue] as const;
}

function BouncyAccordionRow({
  item,
  open,
  contentId,
  triggerId,
  reduce,
  classNames,
  onToggle,
}: {
  item: BouncyAccordionItem;
  open: boolean;
  contentId: string;
  triggerId: string;
  reduce: boolean | null;
  classNames?: BouncyAccordionClassNames;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const updateHeight = () => {
      if (node.offsetHeight > 0) {
        setContentHeight(node.offsetHeight);
      }
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <motion.div
      layout="position"
      initial={false}
      transition={reduce ? { duration: 0 } : ROW_TRANSITION}
      className="mb-2.5 last:mb-0"
    >
      <motion.div
        data-state={open ? "open" : "closed"}
        initial={false}
        transition={reduce ? { duration: 0 } : ROW_TRANSITION}
        className={cn(
          "overflow-hidden rounded-xl border transition-colors",
          open
            ? "bg-white/[0.035] border-white/[0.12] shadow-lg shadow-black/40"
            : "bg-white/[0.015] border-white/[0.06] hover:bg-white/[0.025] hover:border-white/[0.09]",
          item.disabled && "opacity-50",
          classNames?.item
        )}
      >
        <button
          id={triggerId}
          type="button"
          disabled={item.disabled}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          className={cn(
            "flex min-h-[48px] w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors select-none",
            "focus-visible:bg-white/[0.04]",
            "disabled:pointer-events-none",
            classNames?.trigger
          )}
        >
          {item.icon ? (
            <span
              className={cn(
                "shrink-0 flex items-center justify-center text-zinc-400",
                classNames?.icon
              )}
            >
              {item.icon}
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <span
              className={cn(
                "truncate text-xs font-semibold tracking-tight block",
                open ? "text-white" : "text-zinc-300",
                classNames?.title
              )}
            >
              {item.title}
            </span>
            {item.subtitle && (
              <p className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
                {item.subtitle}
              </p>
            )}
          </div>

          {item.trailingIcon !== undefined ? (
            <span
              aria-hidden
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center text-zinc-500",
                classNames?.chevron
              )}
            >
              {item.trailingIcon}
            </span>
          ) : (
            <motion.span
              aria-hidden
              animate={{ rotate: open ? 180 : 0 }}
              transition={reduce ? { duration: 0 } : CHEVRON_TRANSITION}
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center text-zinc-400",
                classNames?.chevron
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </button>

        <motion.div
          layout="size"
          id={contentId}
          role="region"
          aria-labelledby={triggerId}
          aria-hidden={!open}
          initial={false}
          style={{ height: open ? (contentHeight ?? "auto") : 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : open
                ? CONTENT_OPEN_TRANSITION
                : CONTENT_CLOSE_TRANSITION
          }
          className={cn("overflow-hidden", classNames?.content)}
        >
          <motion.div
            ref={contentRef}
            animate={{
              opacity: open ? 1 : 0,
              y: open ? 0 : -6,
            }}
            transition={reduce ? { duration: 0 } : DESCRIPTION_TRANSITION}
            className="px-4 pb-4 pt-1 border-t border-white/[0.04]"
          >
            {item.content}
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function BouncyAccordion({
  items,
  value,
  defaultValue = null,
  onValueChange,
  collapsible = true,
  className,
  classNames,
}: BouncyAccordionProps) {
  const reduce = useReducedMotion();
  const baseId = useId();
  const [activeValue, setActiveValue] = useControllableAccordionValue({
    value,
    defaultValue,
    onValueChange,
  });

  const toggleItem = useCallback(
    (id: string) => {
      if (activeValue === id) {
        if (collapsible) {
          setActiveValue(null);
        }
        return;
      }
      setActiveValue(id);
    },
    [activeValue, collapsible, setActiveValue]
  );

  return (
    <div className={cn("w-full", className, classNames?.root)}>
      {items.map((item) => {
        const open = activeValue === item.id;
        const contentId = `${baseId}-${item.id}-content`;
        const triggerId = `${baseId}-${item.id}-trigger`;

        return (
          <BouncyAccordionRow
            key={item.id}
            item={item}
            open={open}
            contentId={contentId}
            triggerId={triggerId}
            reduce={reduce}
            classNames={classNames}
            onToggle={() => toggleItem(item.id)}
          />
        );
      })}
    </div>
  );
}
