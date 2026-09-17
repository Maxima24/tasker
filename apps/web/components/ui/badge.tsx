import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "border-ink-300 bg-ink-100 text-ink-700",
        outline: "border-ink-300 bg-transparent text-ink-700",
        solid: "border-ink-700 bg-ink-700 text-white",
        muted: "border-ink-300 bg-white text-ink-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
