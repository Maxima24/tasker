import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-10 w-full rounded-md border border-ink-300 bg-white px-3 text-[0.95rem] text-ink-900 placeholder:text-ink-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
