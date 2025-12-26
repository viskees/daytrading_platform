import React from "react";
import { Button } from "@/components/ui/button";
import { GripVertical } from "lucide-react";

type Props = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;

  /** Optional drag handle props from dnd-kit (listeners/attributes) */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
};

export default function DashboardPanel({
  title,
  isOpen,
  onToggle,
  children,
  dragHandleProps,
}: Props) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {dragHandleProps ? (
            <button
              type="button"
              {...dragHandleProps}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground"
              aria-label="Drag to reorder"
              title="Drag to reorder"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : null}

          <h2 className="text-sm font-semibold">{title}</h2>
        </div>

        <Button variant="outline" size="sm" onClick={onToggle}>
          {isOpen ? "Close" : "Open"}
        </Button>
      </div>

      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
}