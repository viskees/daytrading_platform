import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[80px] w-full rounded-xl border border-zinc-300/60 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm",
        "placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-400 dark:border-zinc-700/60 dark:focus-visible:ring-zinc-600",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
