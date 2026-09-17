import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-24 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-[0.95rem] leading-relaxed text-ink-900 placeholder:text-ink-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
