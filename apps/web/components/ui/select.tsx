import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** visual size of the trigger */
  selectSize?: "sm" | "md";
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, selectSize = "md", ...props }, ref) => {
    return (
      <div className="relative inline-flex w-full items-center">
        <select
          ref={ref}
          className={cn(
            "w-full appearance-none rounded-md border border-ink-300 bg-white pr-8 text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-60",
            selectSize === "sm" ? "h-8 pl-2.5 text-sm" : "h-10 pl-3 text-[0.95rem]",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-ink-400" />
      </div>
    );
  },
);
Select.displayName = "Select";
