"use client";

import { cn } from "@/lib/utils";
import { useState, useRef, useCallback, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), 200);
  }, []);

  const handleLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  }, []);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={cn(
            "absolute z-50 px-2.5 py-1.5 rounded-md",
            "bg-espresso text-cream text-[11px] font-sans font-medium",
            "whitespace-nowrap shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
            side === "top" && "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
            side === "bottom" && "top-full left-1/2 -translate-x-1/2 mt-1.5",
            className,
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export { Tooltip, type TooltipProps };
