import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-black text-white border-transparent dark:bg-white dark:text-black",
        secondary: "bg-muted text-foreground border-transparent",
        outline: "bg-transparent",

        // semantic variants for scanner UI
        success: "bg-emerald-600/15 text-emerald-500 border-emerald-600/25",
        danger: "bg-red-600/15 text-red-500 border-red-600/25",
        warn: "bg-amber-500/15 text-amber-500 border-amber-500/25",
        info: "bg-sky-500/15 text-sky-400 border-sky-500/25",
      },
    },
    defaultVariants: { variant: "secondary" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}