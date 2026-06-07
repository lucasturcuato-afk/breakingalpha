"use client";

import { cn } from "@/lib/utils";
import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Allow text to wrap (for longer tooltip content). */
  wrap?: boolean;
  className?: string;
}

function Tooltip({ content, children, side = "top", wrap, className }: TooltipProps) {
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={cn(
            "absolute z-50 px-4 py-3 rounded-xl",
            "font-sans text-[13px] leading-[1.5] font-normal normal-case tracking-normal",
            "bg-cream text-text-primary border border-border-base",
            "dark:bg-elevated dark:text-foreground dark:border-border-default",
            "shadow-[0_4px_20px_rgba(26,18,8,0.08),0_1px_3px_rgba(26,18,8,0.04)]",
            "dark:shadow-[0_4px_20px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.2)]",
            "pointer-events-none",
            "animate-in fade-in-0 zoom-in-95",
            wrap ? "min-w-[240px] max-w-[320px] whitespace-normal" : "whitespace-nowrap",
            side === "top" && "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
            side === "bottom" && "top-full left-1/2 -translate-x-1/2 mt-1.5",
            side === "left" && "right-full top-1/2 -translate-y-1/2 mr-1.5",
            side === "right" && "left-full top-1/2 -translate-y-1/2 ml-1.5",
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
