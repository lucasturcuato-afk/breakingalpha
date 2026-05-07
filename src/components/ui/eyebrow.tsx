"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EyebrowProps {
  children: ReactNode;
  color?: string;
  className?: string;
  as?: "p" | "span" | "h2";
  testId?: string;
}

export function Eyebrow({ children, color = "var(--gold)", className, as = "p", testId }: EyebrowProps) {
  const Component = as;
  return (
    <Component
      className={cn("font-sans text-[10px] uppercase font-bold m-0", className)}
      data-testid={testId ?? "eyebrow-label"}
      style={{ color, letterSpacing: "0.14em" }}
    >
      {children}
    </Component>
  );
}
