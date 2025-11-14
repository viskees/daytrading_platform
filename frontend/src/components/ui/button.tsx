import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition " +
    "focus-visible:outline-none focus-visible:ring-2 ring-offset-2 disabled:opacity-50 disabled:pointer-events-none " +
    "px-3 py-2 border",
  {
    variants: {
      variant: {
        default: "bg-black text-white dark:bg-white dark:text-black border-transparent hover:opacity-90",
        outline: "bg-transparent border-input hover:bg-muted",
        ghost: "bg-transparent border-transparent hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground border-transparent",
      },
      size: { sm: "h-8 px-2", md: "h-9 px-3", lg: "h-10 px-4" },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
);
Button.displayName = "Button";

export { buttonVariants };
