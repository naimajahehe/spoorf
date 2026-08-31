import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  id?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  id,
  checked = false,
  onCheckedChange,
  className,
}) => {
  return (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange?.(!checked);
      }}
      className={cn(
        "size-4 shrink-0 rounded border transition-all flex items-center justify-center cursor-pointer outline-none",
        checked
          ? "bg-white border-white text-black"
          : "bg-white/[0.04] border-white/[0.2] text-transparent hover:border-white/[0.4] hover:bg-white/[0.08]",
        className
      )}
    >
      {checked && <Check size={12} className="stroke-[3] text-black" />}
    </button>
  );
};
