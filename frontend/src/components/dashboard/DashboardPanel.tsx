import React from "react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
};

export default function DashboardPanel({ title, isOpen, onToggle, children, rightSlot }: Props) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {rightSlot}
          <Button variant="outline" size="sm" onClick={onToggle}>
            {isOpen ? "Close" : "Open"}
          </Button>
        </div>
      </div>

      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
}