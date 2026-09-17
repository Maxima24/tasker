import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-ink-700 text-white hover:bg-ink-900 border border-ink-700",
        secondary:
          "bg-white text-ink-900 border border-ink-300 hover:bg-ink-100",
        ghost:
          "bg-transparent text-ink-700 hover:bg-ink-100 border border-transparent",
        accent:
          "bg-ink-500 text-white hover:bg-ink-700 border border-ink-500",
        danger:
          "bg-white text-status-rejected border border-status-rejected hover:bg-ink-100",
        link: "bg-transparent text-ink-500 underline-offset-4 hover:underline border-none px-0",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-[0.95rem]",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
