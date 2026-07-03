"use client";

import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { type ReactNode } from "react";

interface RightPanelProps {
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export function RightPanel({ open, onToggle, children }: RightPanelProps) {
  return (
    <div className="relative flex-shrink-0">
      {/* Toggle button */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "absolute -left-3 top-4 z-10",
          "w-6 h-6 flex items-center justify-center",
          "bg-cream dark:bg-elevated border border-border-base rounded-full",
          "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
          "hover:border-border-hover hover:bg-parchment-mid",
          "cursor-pointer",
        )}
        aria-label={open ? "Collapse panel" : "Expand panel"}
      >
        <ChevronRight
          size={12}
          className={cn(
            "text-text-faint transition-transform duration-[var(--duration-base)]",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Panel body. Inner scroller anchors widgets to the top of the
          scroll container — the sticky wrapper guarantees the widget stack
          stays at top-0 even when the panel internally scrolls past its
          natural position, so the rail never floats mid-viewport. */}
      <div
        className={cn(
          "h-full overflow-hidden border-l border-border-base bg-cream dark:bg-sidebar-bg",
          "transition-all duration-[var(--duration-slow)] ease-[var(--ease-out)]",
          open ? "w-[var(--right-panel-width)]" : "w-0 border-l-0",
        )}
      >
        <div className="w-[var(--right-panel-width)] h-full overflow-y-auto">
          <div className="px-4 py-4 space-y-5 max-h-screen overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PanelWidgetProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export function PanelWidget({ title, action, children }: PanelWidgetProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-sans text-[12px] font-semibold text-text-muted">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
