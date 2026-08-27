"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EyebrowProps {
  children: ReactNode;
  color?: string;
  className?: string;
  as?: "p" | "span" | "h2";
  testId?: string;
  /**
   * Typeface variant. `sans` (default) matches the legacy 10px/0.14em
   * sans-serif treatment used in card chrome. `mono` switches to the
   * 9.5px / 0.10em mono treatment specified by DirectionD L596 + L710 for
   * KPI strip + Trend rail eyebrows.
   */
  variant?: "sans" | "mono";
}

export function Eyebrow({
  children,
  color = "var(--gold)",
  className,
  as = "p",
  testId,
  variant = "sans",
}: EyebrowProps) {
  const Component = as;
  const isMono = variant === "mono";
  return (
    <Component
      className={cn(
        isMono
          ? "font-mono text-[9.5px] uppercase font-semibold m-0"
          : "font-sans text-[10px] uppercase font-bold m-0",
        className,
      )}
      data-testid={testId ?? "eyebrow-label"}
      style={{ color, letterSpacing: isMono ? "0.10em" : "0.14em" }}
    >
      {children}
    </Component>
  );
}
